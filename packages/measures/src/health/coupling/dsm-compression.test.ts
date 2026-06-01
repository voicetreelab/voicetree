import {gzipSync} from 'node:zlib'
import {readdir, readFile, stat} from 'node:fs/promises'
import {join, relative} from 'node:path'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from '../../_shared/discovery/discover-packages'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const REPO_ROOT: string = DEFAULT_REPO_ROOT
const {maxCompressedToOriginalRatio: MAX_COMPRESSED_TO_ORIGINAL_RATIO} = readBudgetSync<{maxCompressedToOriginalRatio: number}>('coupling/dsm-compression.json')


type ImportEdge = {
    readonly fromPackage: string
    readonly toPackage: string
    readonly importPath: string
    readonly file: string
    readonly line: number
    readonly isTypeOnly: boolean
}

type Dsm = {
    readonly packages: readonly string[]
    readonly matrix: readonly (readonly number[])[]
}

type CompressionReport = {
    readonly originalSize: number
    readonly compressedSize: number
    readonly compressedToOriginalRatio: number
}

type LayeringViolation = {
    readonly fromPackage: string
    readonly toPackage: string
    readonly count: number
    readonly fromIndex: number
    readonly toIndex: number
}

async function pathExists(p: string): Promise<boolean> {
    try {
        await stat(p)
        return true
    } catch {
        return false
    }
}

async function listProductionSources(root: string): Promise<string[]> {
    if (!(await pathExists(root))) return []
    const entries = await readdir(root, {withFileTypes: true})
    const nested = await Promise.all(entries.map(async entry => {
        const path = join(root, entry.name)
        if (entry.isDirectory()) return listProductionSources(path)
        if (entry.isFile()
            && path.endsWith('.ts')
            && !path.endsWith('/__audit_seed__.ts')
            && !path.endsWith('.test.ts')
            && !path.endsWith('.spec.ts')
            && !path.includes('/__tests__/')) {
            return [path]
        }
        return []
    }))
    return nested.flat().sort()
}

function extractImportEdges(
    filePath: string,
    text: string,
    fromPackage: string,
    siblingNames: ReadonlyMap<string, string>,
): ImportEdge[] {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const edges: ImportEdge[] = []

    for (const statement of sourceFile.statements) {
        let specifier: string | undefined
        let isTypeOnly = false

        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            specifier = statement.moduleSpecifier.text
            isTypeOnly = statement.importClause?.isTypeOnly ?? false
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            specifier = statement.moduleSpecifier.text
            isTypeOnly = statement.isTypeOnly
        }

        if (!specifier) continue

        for (const [npmName, dirName] of siblingNames) {
            if (dirName === fromPackage) continue
            if (specifier === npmName || specifier.startsWith(npmName + '/')) {
                const {line} = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile))
                edges.push({fromPackage, toPackage: dirName, importPath: specifier, file: relative(REPO_ROOT, filePath), line: line + 1, isTypeOnly})
                break
            }
        }
    }

    return edges
}

async function scanAllEdges(packages: readonly PackageInfo[]): Promise<ImportEdge[]> {
    const siblingNames: ReadonlyMap<string, string> = new Map(packages.map(p => [p.name, p.dirName]))
    const allEdges: ImportEdge[] = []

    for (const pkg of packages) {
        const files = await listProductionSources(pkg.srcRoot)
        const fileEdges = await Promise.all(files.map(async file => {
            const text = await readFile(file, 'utf8')
            return extractImportEdges(file, text, pkg.dirName, siblingNames)
        }))
        allEdges.push(...fileEdges.flat())
    }

    return allEdges.sort((a, b) => `${a.fromPackage}:${a.toPackage}:${a.importPath}:${a.file}:${a.line}`.localeCompare(`${b.fromPackage}:${b.toPackage}:${b.importPath}:${b.file}:${b.line}`))
}

function buildDsm(packageNames: readonly string[], edges: readonly ImportEdge[]): Dsm {
    const indexByPackage = new Map(packageNames.map((name, index) => [name, index]))
    const pathsByCell = new Map<string, Set<string>>()

    for (const edge of edges) {
        const key = `${edge.fromPackage}\u0000${edge.toPackage}`
        const paths = pathsByCell.get(key)
        if (paths) paths.add(edge.importPath)
        else pathsByCell.set(key, new Set([edge.importPath]))
    }

    const matrix = packageNames.map(fromPackage => {
        return packageNames.map(toPackage => {
            if (!indexByPackage.has(fromPackage) || !indexByPackage.has(toPackage) || fromPackage === toPackage) return 0
            return pathsByCell.get(`${fromPackage}\u0000${toPackage}`)?.size ?? 0
        })
    })

    return {packages: packageNames, matrix}
}

function canonicalDsmJson(dsm: Dsm): string {
    return JSON.stringify({packages: dsm.packages, matrix: dsm.matrix})
}

function compressionReport(canonical: string): CompressionReport {
    const originalSize = Buffer.byteLength(canonical)
    const compressedSize = gzipSync(canonical).byteLength
    return {
        originalSize,
        compressedSize,
        compressedToOriginalRatio: compressedSize / originalSize,
    }
}

function getCell(dsm: Dsm, fromPackage: string, toPackage: string): number {
    const fromIndex = dsm.packages.indexOf(fromPackage)
    const toIndex = dsm.packages.indexOf(toPackage)
    if (fromIndex < 0 || toIndex < 0) return 0
    return dsm.matrix[fromIndex]?.[toIndex] ?? 0
}

function orderByDependencyDepth(dsm: Dsm): string[] {
    const memo = new Map<string, number>()

    const depthOf = (packageName: string, path: ReadonlySet<string>): number => {
        const cached = memo.get(packageName)
        if (cached !== undefined) return cached
        const dependencies = dsm.packages.filter(dep => dep !== packageName && getCell(dsm, packageName, dep) > 0)
        const dependencyDepths = dependencies
            .filter(dep => !path.has(dep))
            .map(dep => depthOf(dep, new Set([...path, dep])))
        const depth = dependencyDepths.length === 0 ? 0 : 1 + Math.max(...dependencyDepths)
        memo.set(packageName, depth)
        return depth
    }

    return [...dsm.packages].sort((a, b) => {
        const byDepth = depthOf(b, new Set([b])) - depthOf(a, new Set([a]))
        return byDepth === 0 ? a.localeCompare(b) : byDepth
    })
}

function reorderDsm(dsm: Dsm, order: readonly string[]): Dsm {
    return {
        packages: order,
        matrix: order.map(fromPackage => order.map(toPackage => getCell(dsm, fromPackage, toPackage))),
    }
}

function findLayeringViolations(dsm: Dsm): LayeringViolation[] {
    const violations: LayeringViolation[] = []

    for (let fromIndex = 0; fromIndex < dsm.packages.length; fromIndex++) {
        for (let toIndex = 0; toIndex < dsm.packages.length; toIndex++) {
            const count = dsm.matrix[fromIndex]?.[toIndex] ?? 0
            if (count > 0 && fromIndex > toIndex) {
                violations.push({
                    fromPackage: dsm.packages[fromIndex],
                    toPackage: dsm.packages[toIndex],
                    count,
                    fromIndex,
                    toIndex,
                })
            }
        }
    }

    return violations
}

function formatMatrix(dsm: Dsm): string {
    const rowLabel = 'from \\ to'
    const labelWidth = Math.max(rowLabel.length, ...dsm.packages.map(name => name.length))
    const valueWidth = Math.max(5, ...dsm.packages.map(name => name.length))
    const header = `${rowLabel.padEnd(labelWidth)} | ${dsm.packages.map(name => name.padStart(valueWidth)).join(' | ')}`
    const divider = `${'-'.repeat(labelWidth)}-+-${dsm.packages.map(() => '-'.repeat(valueWidth)).join('-+-')}`
    const rows = dsm.packages.map((fromPackage, fromIndex) => {
        const values = dsm.packages.map((toPackage, toIndex) => {
            const count = fromPackage === toPackage ? '-' : String(dsm.matrix[fromIndex]?.[toIndex] ?? 0)
            return count.padStart(valueWidth)
        })
        return `${fromPackage.padEnd(labelWidth)} | ${values.join(' | ')}`
    })
    return [header, divider, ...rows].join('\n')
}

function formatReport(alphabeticalDsm: Dsm, layeredDsm: Dsm, report: CompressionReport, violations: readonly LayeringViolation[]): string {
    return [
        '',
        'Dependency Structure Matrix (distinct import paths, alphabetical order)',
        formatMatrix(alphabeticalDsm),
        '',
        'Dependency-depth order (dependents before dependencies)',
        layeredDsm.packages.join(' -> '),
        '',
        'Layered DSM (must be upper triangular)',
        formatMatrix(layeredDsm),
        '',
        `Canonical DSM JSON bytes: ${report.originalSize}`,
        `Gzip DSM bytes: ${report.compressedSize}`,
        `Compressed/original ratio: ${report.compressedToOriginalRatio.toFixed(4)}`,
        `Max compressed/original ratio budget: ${MAX_COMPRESSED_TO_ORIGINAL_RATIO.toFixed(4)}`,
        '',
        'Layering violations below diagonal:',
        violations.length === 0
            ? '  none'
            : violations.map(v => `  ${v.fromPackage} -> ${v.toPackage}: ${v.count} path(s), row ${v.fromIndex + 1} > col ${v.toIndex + 1}`).join('\n'),
    ].join('\n')
}

describe('DSM compression and layering', () => {
    it('systems package dependency matrix stays compressible and upper triangular', async () => {
        const packages = await discoverPackages()
        const packageNames = packages.map(pkg => pkg.dirName)
        const edges = await scanAllEdges(packages)
        const alphabeticalDsm = buildDsm(packageNames, edges)
        const layeredDsm = reorderDsm(alphabeticalDsm, orderByDependencyDepth(alphabeticalDsm))
        const report = compressionReport(canonicalDsmJson(alphabeticalDsm))
        const violations = findLayeringViolations(layeredDsm)
        const formattedReport = formatReport(alphabeticalDsm, layeredDsm, report, violations)

        console.info(formattedReport)

        await recordHealthMetric({
            metricId: 'dsm-compression-ratio',
            metricName: 'DSM Compression Ratio',
            description: 'Compressed-to-original size ratio for the systems package dependency matrix.',
            category: 'Structure',
            current: report.compressedToOriginalRatio,
            budget: MAX_COMPRESSED_TO_ORIGINAL_RATIO,
            comparison: 'lte',
            unit: 'ratio',
            details: {
                originalSize: report.originalSize,
                compressedSize: report.compressedSize,
                packageOrder: layeredDsm.packages,
            },
        })
        await recordHealthMetric({
            metricId: 'dsm-layering',
            metricName: 'DSM Layering Violations',
            description: 'Count of package dependency entries below the dependency-depth diagonal.',
            category: 'Structure',
            current: violations.length,
            budget: 0,
            comparison: 'lte',
            unit: 'violations',
            details: {violations},
        })

        expect(report.compressedToOriginalRatio, formattedReport).toBeLessThanOrEqual(MAX_COMPRESSED_TO_ORIGINAL_RATIO)
        expect(violations, formattedReport).toEqual([])
    })
})
