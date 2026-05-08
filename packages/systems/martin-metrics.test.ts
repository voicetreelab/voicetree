import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'

const SYSTEMS_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')

type PackageInfo = {
    readonly name: string
    readonly dirName: string
    readonly srcRoot: string
}

type ImportEdge = {
    readonly fromPackage: string
    readonly toPackage: string
    readonly importPath: string
    readonly file: string
    readonly line: number
    readonly isTypeOnly: boolean
}

type MartinMetric = {
    readonly packageName: string
    readonly ca: number
    readonly ce: number
    readonly instability: number
}

type StableDependenciesViolation = {
    readonly fromPackage: string
    readonly toPackage: string
    readonly fromInstability: number
    readonly toInstability: number
    readonly examples: readonly ImportEdge[]
}

async function discoverPackages(): Promise<PackageInfo[]> {
    const entries = await readdir(SYSTEMS_ROOT, {withFileTypes: true})
    const results = await Promise.all(entries.map(async entry => {
        if (!entry.isDirectory()) return null
        const pkgJsonPath = join(SYSTEMS_ROOT, entry.name, 'package.json')
        try {
            const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
            return {
                name: pkgJson.name as string,
                dirName: entry.name,
                srcRoot: join(SYSTEMS_ROOT, entry.name, 'src'),
            }
        } catch {
            return null
        }
    }))
    return results.filter((p): p is PackageInfo => p !== null)
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
        if (entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.spec.ts') && !path.includes('/__tests__/')) {
            return [path]
        }
        return []
    }))
    return nested.flat()
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

    return allEdges
}

function computeMartinMetrics(packages: readonly PackageInfo[], edges: readonly ImportEdge[]): MartinMetric[] {
    const afferent = new Map<string, Set<string>>()
    const efferent = new Map<string, Set<string>>()

    for (const pkg of packages) {
        afferent.set(pkg.dirName, new Set())
        efferent.set(pkg.dirName, new Set())
    }

    for (const edge of edges) {
        if (edge.fromPackage === edge.toPackage) continue
        afferent.get(edge.toPackage)?.add(edge.fromPackage)
        efferent.get(edge.fromPackage)?.add(edge.toPackage)
    }

    return packages
        .map(pkg => {
            const ca = afferent.get(pkg.dirName)?.size ?? 0
            const ce = efferent.get(pkg.dirName)?.size ?? 0
            const instability = ca + ce === 0 ? 0 : ce / (ca + ce)
            return {packageName: pkg.dirName, ca, ce, instability}
        })
        .sort((a, b) => a.packageName.localeCompare(b.packageName))
}

function findStableDependenciesViolations(
    metrics: readonly MartinMetric[],
    edges: readonly ImportEdge[],
): StableDependenciesViolation[] {
    const metricByPackage = new Map(metrics.map(metric => [metric.packageName, metric]))
    const edgesByPair = new Map<string, ImportEdge[]>()

    for (const edge of edges) {
        const key = `${edge.fromPackage} -> ${edge.toPackage}`
        const existing = edgesByPair.get(key)
        if (existing) existing.push(edge)
        else edgesByPair.set(key, [edge])
    }

    const violations: StableDependenciesViolation[] = []
    for (const pairEdges of edgesByPair.values()) {
        const first = pairEdges[0]
        if (!first) continue
        const from = metricByPackage.get(first.fromPackage)
        const to = metricByPackage.get(first.toPackage)
        if (!from || !to) continue
        if (from.instability < to.instability) {
            violations.push({
                fromPackage: first.fromPackage,
                toPackage: first.toPackage,
                fromInstability: from.instability,
                toInstability: to.instability,
                examples: pairEdges.slice(0, 5),
            })
        }
    }

    return violations.sort((a, b) => `${a.fromPackage} -> ${a.toPackage}`.localeCompare(`${b.fromPackage} -> ${b.toPackage}`))
}

function formatInstability(value: number): string {
    return value.toFixed(2)
}

function formatMetricsTable(metrics: readonly MartinMetric[]): string {
    const lines: string[] = [
        '',
        '+-----------------+----+----+------+',
        '| Package         | Ca | Ce | I    |',
        '+-----------------+----+----+------+',
    ]

    for (const metric of metrics) {
        lines.push(`| ${metric.packageName.padEnd(15)} | ${String(metric.ca).padStart(2)} | ${String(metric.ce).padStart(2)} | ${formatInstability(metric.instability).padStart(4)} |`)
    }

    lines.push('+-----------------+----+----+------+')
    return lines.join('\n')
}

function formatViolations(violations: readonly StableDependenciesViolation[]): string {
    if (violations.length === 0) return 'Stable Dependencies Principle violations: none'

    const lines = ['Stable Dependencies Principle violations:']
    for (const violation of violations) {
        lines.push(`- ${violation.fromPackage} (I=${formatInstability(violation.fromInstability)}) -> ${violation.toPackage} (I=${formatInstability(violation.toInstability)})`)
        for (const edge of violation.examples) {
            lines.push(`  ${edge.file}:${edge.line} imports ${edge.importPath}${edge.isTypeOnly ? ' (type-only)' : ''}`)
        }
    }
    return lines.join('\n')
}

describe('Martin package metrics', () => {
    it('systems packages depend in the direction of stability', async () => {
        const packages = await discoverPackages()
        const edges = await scanAllEdges(packages)
        const metrics = computeMartinMetrics(packages, edges)
        const violations = findStableDependenciesViolations(metrics, edges)

        console.info(formatMetricsTable(metrics))
        console.info(formatViolations(violations))

        expect(
            violations.map(v => `${v.fromPackage} (I=${formatInstability(v.fromInstability)}) -> ${v.toPackage} (I=${formatInstability(v.toInstability)})`),
            formatViolations(violations),
        ).toEqual([])
    })
})
