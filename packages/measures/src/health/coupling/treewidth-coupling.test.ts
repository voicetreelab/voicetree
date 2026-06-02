import {readdir, readFile, stat} from 'node:fs/promises'
import {join, relative} from 'node:path'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from '../../_shared/discovery/discover-packages'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const REPO_ROOT: string = DEFAULT_REPO_ROOT
const {max: TREE_WIDTH_BUDGET} = readBudgetSync<{max: number}>('coupling/treewidth.json')


type ImportEdge = {
    readonly fromPackage: string
    readonly toPackage: string
    readonly importPath: string
    readonly file: string
    readonly line: number
    readonly isTypeOnly: boolean
}

type McsStep = {
    readonly packageName: string
    readonly numberedNeighbors: readonly string[]
    readonly bagSize: number
}

type TreeWidthEstimate = {
    readonly ordering: readonly string[]
    readonly steps: readonly McsStep[]
    readonly treeWidth: number
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

    return allEdges
}

function buildUndirectedAdjacency(packageNames: readonly string[], edges: readonly ImportEdge[]): ReadonlyMap<string, ReadonlySet<string>> {
    const adjacency = new Map(packageNames.map(name => [name, new Set<string>()]))

    for (const edge of edges) {
        adjacency.get(edge.fromPackage)?.add(edge.toPackage)
        adjacency.get(edge.toPackage)?.add(edge.fromPackage)
    }

    return adjacency
}

function computeMcsTreeWidthLowerBound(adjacency: ReadonlyMap<string, ReadonlySet<string>>): TreeWidthEstimate {
    const unnumbered = new Set([...adjacency.keys()])
    const numbered = new Set<string>()
    const steps: McsStep[] = []

    while (unnumbered.size > 0) {
        const candidates = [...unnumbered]
            .map(packageName => ({
                packageName,
                numberedNeighbors: [...(adjacency.get(packageName) ?? new Set<string>())]
                    .filter(neighbor => numbered.has(neighbor))
                    .sort(),
            }))
            .sort((a, b) => {
                const byMarkedNeighbors = b.numberedNeighbors.length - a.numberedNeighbors.length
                return byMarkedNeighbors === 0 ? a.packageName.localeCompare(b.packageName) : byMarkedNeighbors
            })
        const next = candidates[0]
        if (!next) break

        steps.push({
            packageName: next.packageName,
            numberedNeighbors: next.numberedNeighbors,
            bagSize: next.numberedNeighbors.length + 1,
        })
        numbered.add(next.packageName)
        unnumbered.delete(next.packageName)
    }

    return {
        ordering: steps.map(step => step.packageName),
        steps,
        treeWidth: Math.max(0, ...steps.map(step => step.bagSize - 1)),
    }
}

function formatAdjacency(adjacency: ReadonlyMap<string, ReadonlySet<string>>): string {
    return [...adjacency]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([packageName, neighbors]) => `  ${packageName}: ${[...neighbors].sort().join(', ') || 'none'}`)
        .join('\n')
}

function formatTreeWidthReport(adjacency: ReadonlyMap<string, ReadonlySet<string>>, estimate: TreeWidthEstimate): string {
    const lines: string[] = [
        '',
        'Tree-width coupling estimate (MCS lower bound)',
        `Budget: ${TREE_WIDTH_BUDGET}`,
        `Estimate: ${estimate.treeWidth}`,
        `Elimination ordering: ${estimate.ordering.join(' -> ')}`,
        '',
        'Undirected package graph:',
        formatAdjacency(adjacency),
        '',
        'MCS bags:',
    ]

    for (const [index, step] of estimate.steps.entries()) {
        const neighbors = step.numberedNeighbors.length === 0 ? 'none' : step.numberedNeighbors.join(', ')
        lines.push(`  ${index + 1}. ${step.packageName}: bag size ${step.bagSize}; numbered neighbors: ${neighbors}`)
    }

    return lines.join('\n')
}

describe('tree-width coupling bounds', () => {
    it('systems package import graph stays within the tree-width budget', async () => {
        const packages = await discoverPackages()
        const packageNames = packages.map(pkg => pkg.dirName)
        const edges = await scanAllEdges(packages)
        const adjacency = buildUndirectedAdjacency(packageNames, edges)
        const estimate = computeMcsTreeWidthLowerBound(adjacency)
        const report = formatTreeWidthReport(adjacency, estimate)

        console.info(report)

        await recordHealthMetric({
            metricId: 'treewidth',
            metricName: 'Import Graph Tree-Width',
            description: 'MCS lower-bound tree-width of the systems package import graph.',
            category: 'Structure',
            current: estimate.treeWidth,
            budget: TREE_WIDTH_BUDGET,
            comparison: 'lte',
            unit: 'width',
            details: {
                ordering: estimate.ordering,
                steps: estimate.steps,
                packages: [...adjacency.keys()].sort(),
            },
        })

        expect(estimate.treeWidth, report).toBeLessThanOrEqual(TREE_WIDTH_BUDGET)
    })
})
