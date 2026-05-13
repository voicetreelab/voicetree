import {readdir, readFile, stat} from 'node:fs/promises'
import {join, relative} from 'node:path'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from './discover-packages'
import {recordHealthMetric} from './_health-report-test-helpers'

const REPO_ROOT: string = DEFAULT_REPO_ROOT


type ImportEdge = {
    readonly fromPackage: string
    readonly toPackage: string
    readonly importPath: string
    readonly file: string
    readonly line: number
    readonly isTypeOnly: boolean
}

type DsmMatrix = ReadonlyMap<string, ReadonlyMap<string, number>>

type CycleReport = {
    readonly fromPackage: string
    readonly toPackage: string
    readonly forwardCount: number
    readonly reverseCount: number
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
        if (entry.isFile() && path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.spec.ts') && !path.includes('/__tests__/')) {
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

    return allEdges
}

function buildDsmMatrix(packageNames: readonly string[], edges: readonly ImportEdge[]): DsmMatrix {
    const matrix = new Map<string, Map<string, number>>()
    for (const fromPackage of packageNames) {
        matrix.set(fromPackage, new Map(packageNames.map(toPackage => [toPackage, 0])))
    }

    for (const edge of edges) {
        const row = matrix.get(edge.fromPackage)
        if (!row) continue
        row.set(edge.toPackage, (row.get(edge.toPackage) ?? 0) + 1)
    }

    return matrix
}

function getCell(matrix: DsmMatrix, fromPackage: string, toPackage: string): number {
    return matrix.get(fromPackage)?.get(toPackage) ?? 0
}

function buildAdjacency(packageNames: readonly string[], matrix: DsmMatrix): ReadonlyMap<string, ReadonlySet<string>> {
    return new Map(packageNames.map(fromPackage => [
        fromPackage,
        new Set(packageNames.filter(toPackage => fromPackage !== toPackage && getCell(matrix, fromPackage, toPackage) > 0)),
    ]))
}

function findSymmetricCycles(packageNames: readonly string[], matrix: DsmMatrix): CycleReport[] {
    const cycles: CycleReport[] = []
    for (let i = 0; i < packageNames.length; i++) {
        for (let j = i + 1; j < packageNames.length; j++) {
            const fromPackage = packageNames[i]
            const toPackage = packageNames[j]
            const forwardCount = getCell(matrix, fromPackage, toPackage)
            const reverseCount = getCell(matrix, toPackage, fromPackage)
            if (forwardCount > 0 && reverseCount > 0) {
                cycles.push({fromPackage, toPackage, forwardCount, reverseCount})
            }
        }
    }
    return cycles
}

function orderByDependencyDepth(packageNames: readonly string[], matrix: DsmMatrix): string[] {
    const adjacency = buildAdjacency(packageNames, matrix)
    const memo = new Map<string, number>()

    const depthOf = (pkg: string, path: ReadonlySet<string>): number => {
        const cached = memo.get(pkg)
        if (cached !== undefined) return cached
        const deps = adjacency.get(pkg) ?? new Set<string>()
        const nextDepths = [...deps]
            .filter(dep => !path.has(dep))
            .map(dep => depthOf(dep, new Set([...path, dep])))
        const depth = nextDepths.length === 0 ? 0 : 1 + Math.max(...nextDepths)
        memo.set(pkg, depth)
        return depth
    }

    return [...packageNames].sort((a, b) => {
        const byDepth = depthOf(b, new Set([b])) - depthOf(a, new Set([a]))
        return byDepth === 0 ? a.localeCompare(b) : byDepth
    })
}

function findLayeringViolations(order: readonly string[], matrix: DsmMatrix): LayeringViolation[] {
    const indexByPackage = new Map(order.map((pkg, index) => [pkg, index]))
    const violations: LayeringViolation[] = []

    for (const fromPackage of order) {
        for (const toPackage of order) {
            const fromIndex = indexByPackage.get(fromPackage) ?? -1
            const toIndex = indexByPackage.get(toPackage) ?? -1
            const count = getCell(matrix, fromPackage, toPackage)
            if (count > 0 && fromIndex > toIndex) {
                violations.push({fromPackage, toPackage, count, fromIndex, toIndex})
            }
        }
    }

    return violations
}

function formatMatrix(order: readonly string[], matrix: DsmMatrix): string {
    const rowLabel = 'from \\ to'
    const labelWidth = Math.max(rowLabel.length, ...order.map(name => name.length))
    const valueWidth = Math.max(5, ...order.map(name => name.length))
    const header = `${rowLabel.padEnd(labelWidth)} | ${order.map(name => name.padStart(valueWidth)).join(' | ')}`
    const divider = `${'-'.repeat(labelWidth)}-+-${order.map(() => '-'.repeat(valueWidth)).join('-+-')}`
    const rows = order.map(fromPackage => {
        const values = order.map(toPackage => {
            const count = fromPackage === toPackage ? '-' : String(getCell(matrix, fromPackage, toPackage))
            return count.padStart(valueWidth)
        })
        return `${fromPackage.padEnd(labelWidth)} | ${values.join(' | ')}`
    })
    return [header, divider, ...rows].join('\n')
}

function formatReport(packageNames: readonly string[], matrix: DsmMatrix, cycles: readonly CycleReport[], layeringViolations: readonly LayeringViolation[], topologicalOrder: readonly string[]): string {
    const lines: string[] = [
        '',
        'Dependency Structure Matrix (import edge counts)',
        formatMatrix(packageNames, matrix),
        '',
        `Topological order by dependency depth: ${topologicalOrder.join(' -> ')}`,
        '',
        'Cycles (symmetric off-diagonal entries):',
        cycles.length === 0 ? '  none' : cycles.map(c => `  ${c.fromPackage} <-> ${c.toPackage}: ${c.forwardCount}/${c.reverseCount}`).join('\n'),
        '',
        'Layering violations (below diagonal in dependency-depth order):',
        layeringViolations.length === 0
            ? '  none'
            : layeringViolations.map(v => `  ${v.fromPackage} -> ${v.toPackage}: ${v.count} edge(s), row ${v.fromIndex + 1} > col ${v.toIndex + 1}`).join('\n'),
    ]

    return lines.join('\n')
}

describe('Dependency Structure Matrix', () => {
    it('reports cross-package import structure without symmetric package cycles', async () => {
        const packages = await discoverPackages()
        const packageNames = packages.map(pkg => pkg.dirName)
        const edges = await scanAllEdges(packages)
        const matrix = buildDsmMatrix(packageNames, edges)
        const cycles = findSymmetricCycles(packageNames, matrix)
        const topologicalOrder = orderByDependencyDepth(packageNames, matrix)
        const layeringViolations = findLayeringViolations(topologicalOrder, matrix)
        const report = formatReport(packageNames, matrix, cycles, layeringViolations, topologicalOrder)

        console.info(report)

        await recordHealthMetric({
            metricId: 'dsm-symmetric-cycles',
            metricName: 'DSM Symmetric Cycles',
            description: 'Symmetric package dependency cycles visible in the dependency structure matrix.',
            category: 'Structure',
            current: cycles.length,
            budget: 0,
            comparison: 'lte',
            unit: 'cycles',
            details: {
                cycles,
                layeringViolations,
                topologicalOrder,
                packageNames,
            },
        })

        expect(cycles, report).toEqual([])
    })
})
