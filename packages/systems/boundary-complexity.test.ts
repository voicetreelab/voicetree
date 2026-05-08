import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'

const SYSTEMS_ROOT: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SYSTEMS_ROOT, '../..')
const MAX_BOUNDARY_WIDTH_RATIO_BUDGET = 13 / 30
const CROSS_BOUNDARY_TREE_WIDTH_BUDGET = 3

type PackageInfo = {
    readonly name: string
    readonly dirName: string
    readonly srcRoot: string
}

type SourceFileInfo = {
    readonly absolutePath: string
    readonly relativePath: string
    readonly packageName: string
}

type FileImportEdge = {
    readonly fromFile: string
    readonly toFile: string
    readonly fromPackage: string
    readonly toPackage: string
}

type FileImportGraph = {
    readonly nodes: readonly SourceFileInfo[]
    readonly edges: readonly FileImportEdge[]
}

type BoundaryWidth = {
    readonly packageName: string
    readonly totalFiles: number
    readonly boundaryFiles: number
    readonly ratio: number
}

type PairBoundaryEntropy = {
    readonly pair: string
    readonly sourceFiles: number
    readonly targetFiles: number
    readonly edgeCount: number
    readonly entropy: number
}

type McsStep = {
    readonly file: string
    readonly numberedNeighbors: readonly string[]
    readonly bagSize: number
}

type TreeWidthEstimate = {
    readonly ordering: readonly string[]
    readonly steps: readonly McsStep[]
    readonly treeWidth: number
}

type BoundaryComplexityReport = {
    readonly widths: readonly BoundaryWidth[]
    readonly maxBoundaryWidthRatio: number
    readonly pairEntropies: readonly PairBoundaryEntropy[]
    readonly crossBoundaryTreeWidth: TreeWidthEstimate
    readonly crossBoundaryEdgeCount: number
    readonly boundaryFileCount: number
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
    return results.filter((p): p is PackageInfo => p !== null).sort((a, b) => a.dirName.localeCompare(b.dirName))
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

async function scanSourceFiles(packages: readonly PackageInfo[]): Promise<SourceFileInfo[]> {
    const nested = await Promise.all(packages.map(async pkg => {
        const files = await listProductionSources(pkg.srcRoot)
        return files.map(file => ({
            absolutePath: resolve(file),
            relativePath: relative(REPO_ROOT, file),
            packageName: pkg.dirName,
        }))
    }))
    return nested.flat().sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function importSpecifiers(filePath: string, text: string): string[] {
    const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true)
    const specifiers: string[] = []

    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
            specifiers.push(statement.moduleSpecifier.text)
        } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
            specifiers.push(statement.moduleSpecifier.text)
        }
    }

    return specifiers
}

function resolutionCandidates(basePath: string): string[] {
    if (basePath.endsWith('.ts')) return [basePath]
    return [basePath, `${basePath}.ts`, join(basePath, 'index.ts')]
}

function resolveFileCandidate(basePath: string, sourceFilesByPath: ReadonlySet<string>): string | null {
    return resolutionCandidates(resolve(basePath)).find(candidate => sourceFilesByPath.has(candidate)) ?? null
}

function resolvePackageImport(
    specifier: string,
    packagesByNpmName: ReadonlyMap<string, PackageInfo>,
    sourceFilesByPath: ReadonlySet<string>,
): string | null {
    for (const [npmName, pkg] of packagesByNpmName) {
        if (specifier !== npmName && !specifier.startsWith(npmName + '/')) continue

        const subPath = specifier === npmName ? 'index' : specifier.slice(npmName.length + 1)
        return resolveFileCandidate(join(pkg.srcRoot, subPath), sourceFilesByPath)
    }

    return null
}

function resolveImportSpecifier(
    fromFile: SourceFileInfo,
    specifier: string,
    packagesByNpmName: ReadonlyMap<string, PackageInfo>,
    sourceFilesByPath: ReadonlySet<string>,
): string | null {
    if (specifier.startsWith('.')) {
        return resolveFileCandidate(join(dirname(fromFile.absolutePath), specifier), sourceFilesByPath)
    }

    return resolvePackageImport(specifier, packagesByNpmName, sourceFilesByPath)
}

async function buildFileImportGraph(packages: readonly PackageInfo[]): Promise<FileImportGraph> {
    const nodes = await scanSourceFiles(packages)
    const nodesByPath = new Map(nodes.map(node => [node.absolutePath, node]))
    const sourceFilesByPath = new Set(nodesByPath.keys())
    const packagesByNpmName = new Map(packages.map(pkg => [pkg.name, pkg]))
    const dedupedEdges = new Set<string>()

    for (const fromFile of nodes) {
        const text = await readFile(fromFile.absolutePath, 'utf8')
        for (const specifier of importSpecifiers(fromFile.absolutePath, text)) {
            const toPath = resolveImportSpecifier(fromFile, specifier, packagesByNpmName, sourceFilesByPath)
            if (!toPath || toPath === fromFile.absolutePath) continue
            dedupedEdges.add(`${fromFile.absolutePath}\0${toPath}`)
        }
    }

    const edges = [...dedupedEdges].sort().map(edgeKey => {
        const [fromPath, toPath] = edgeKey.split('\0')
        const fromNode = nodesByPath.get(fromPath)!
        const toNode = nodesByPath.get(toPath)!
        return {
            fromFile: fromNode.relativePath,
            toFile: toNode.relativePath,
            fromPackage: fromNode.packageName,
            toPackage: toNode.packageName,
        }
    })

    return {nodes, edges}
}

function crossBoundaryEdges(graph: FileImportGraph): readonly FileImportEdge[] {
    return graph.edges.filter(edge => edge.fromPackage !== edge.toPackage)
}

function boundaryFiles(edges: readonly FileImportEdge[]): ReadonlySet<string> {
    const files = new Set<string>()
    for (const edge of edges) {
        files.add(edge.fromFile)
        files.add(edge.toFile)
    }
    return files
}

function computeBoundaryWidths(
    graph: FileImportGraph,
    packageNames: readonly string[],
    boundaryFileSet: ReadonlySet<string>,
): readonly BoundaryWidth[] {
    return packageNames.map(packageName => {
        const packageFiles = graph.nodes.filter(node => node.packageName === packageName)
        const count = packageFiles.filter(node => boundaryFileSet.has(node.relativePath)).length
        return {
            packageName,
            totalFiles: packageFiles.length,
            boundaryFiles: count,
            ratio: packageFiles.length === 0 ? 0 : count / packageFiles.length,
        }
    })
}

function shannonEntropy(counts: readonly number[]): number {
    const total = counts.reduce((sum, count) => sum + count, 0)
    if (total === 0) return 0
    return counts.reduce((sum, count) => {
        if (count === 0) return sum
        const p = count / total
        return sum - p * Math.log2(p)
    }, 0)
}

function computePairBoundaryEntropies(edges: readonly FileImportEdge[]): readonly PairBoundaryEntropy[] {
    const byPair = new Map<string, FileImportEdge[]>()

    for (const edge of edges) {
        const pair = `${edge.fromPackage} -> ${edge.toPackage}`
        const existing = byPair.get(pair)
        if (existing) existing.push(edge)
        else byPair.set(pair, [edge])
    }

    return [...byPair]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pair, pairEdges]) => {
            const sourceFiles = new Set(pairEdges.map(edge => edge.fromFile))
            const targetFiles = new Set(pairEdges.map(edge => edge.toFile))
            const edgesBySource = new Map<string, number>()
            for (const edge of pairEdges) {
                edgesBySource.set(edge.fromFile, (edgesBySource.get(edge.fromFile) ?? 0) + 1)
            }

            return {
                pair,
                sourceFiles: sourceFiles.size,
                targetFiles: targetFiles.size,
                edgeCount: pairEdges.length,
                entropy: shannonEntropy([...edgesBySource.values()]),
            }
        })
}

function buildBoundaryAdjacency(boundaryFileSet: ReadonlySet<string>, edges: readonly FileImportEdge[]): ReadonlyMap<string, ReadonlySet<string>> {
    const adjacency = new Map([...boundaryFileSet].sort().map(file => [file, new Set<string>()]))

    for (const edge of edges) {
        adjacency.get(edge.fromFile)?.add(edge.toFile)
        adjacency.get(edge.toFile)?.add(edge.fromFile)
    }

    return adjacency
}

function computeMcsTreeWidthLowerBound(adjacency: ReadonlyMap<string, ReadonlySet<string>>): TreeWidthEstimate {
    const unnumbered = new Set([...adjacency.keys()])
    const numbered = new Set<string>()
    const steps: McsStep[] = []

    while (unnumbered.size > 0) {
        const candidates = [...unnumbered]
            .map(file => ({
                file,
                numberedNeighbors: [...(adjacency.get(file) ?? new Set<string>())]
                    .filter(neighbor => numbered.has(neighbor))
                    .sort(),
            }))
            .sort((a, b) => {
                const byMarkedNeighbors = b.numberedNeighbors.length - a.numberedNeighbors.length
                return byMarkedNeighbors === 0 ? a.file.localeCompare(b.file) : byMarkedNeighbors
            })
        const next = candidates[0]
        if (!next) break

        steps.push({
            file: next.file,
            numberedNeighbors: next.numberedNeighbors,
            bagSize: next.numberedNeighbors.length + 1,
        })
        numbered.add(next.file)
        unnumbered.delete(next.file)
    }

    return {
        ordering: steps.map(step => step.file),
        steps,
        treeWidth: Math.max(0, ...steps.map(step => step.bagSize - 1)),
    }
}

function computeBoundaryComplexity(graph: FileImportGraph, packageNames: readonly string[]): BoundaryComplexityReport {
    const crossEdges = crossBoundaryEdges(graph)
    const boundaryFileSet = boundaryFiles(crossEdges)
    const widths = computeBoundaryWidths(graph, packageNames, boundaryFileSet)
    const adjacency = buildBoundaryAdjacency(boundaryFileSet, crossEdges)
    const crossBoundaryTreeWidth = computeMcsTreeWidthLowerBound(adjacency)

    return {
        widths,
        maxBoundaryWidthRatio: Math.max(0, ...widths.map(width => width.ratio)),
        pairEntropies: computePairBoundaryEntropies(crossEdges),
        crossBoundaryTreeWidth,
        crossBoundaryEdgeCount: crossEdges.length,
        boundaryFileCount: boundaryFileSet.size,
    }
}

function formatRatio(value: number): string {
    return value.toFixed(3)
}

function formatEntropy(value: number): string {
    return value.toFixed(3)
}

function formatReport(report: BoundaryComplexityReport): string {
    const lines: string[] = [
        '',
        'Cross-Boundary Complexity Report',
        '',
        'Boundary Width (files touching the boundary / total files):',
    ]

    for (const width of report.widths) {
        lines.push(`  ${width.packageName.padEnd(15)} ${String(width.boundaryFiles).padStart(3)}/${String(width.totalFiles).padEnd(3)} = ${formatRatio(width.ratio)}`)
    }

    lines.push(`  Max boundary width: ${formatRatio(report.maxBoundaryWidthRatio)} (budget: ${formatRatio(MAX_BOUNDARY_WIDTH_RATIO_BUDGET)})`)
    lines.push('')
    lines.push('Per-Pair Boundary Entropy:')

    for (const pair of report.pairEntropies) {
        lines.push(`  ${pair.pair}: ${pair.sourceFiles} source files, ${pair.targetFiles} target files, ${pair.edgeCount} edges, H=${formatEntropy(pair.entropy)}`)
    }

    if (report.pairEntropies.length === 0) {
        lines.push('  none')
    }

    lines.push('')
    lines.push(`Cross-boundary files: ${report.boundaryFileCount}`)
    lines.push(`Cross-boundary edges: ${report.crossBoundaryEdgeCount}`)
    lines.push(`Cross-Boundary Tree-Width (MCS lower bound): ${report.crossBoundaryTreeWidth.treeWidth} (budget: ${CROSS_BOUNDARY_TREE_WIDTH_BUDGET})`)
    lines.push(`MCS ordering: ${report.crossBoundaryTreeWidth.ordering.join(' -> ') || 'none'}`)
    lines.push('MCS bags:')

    for (const [index, step] of report.crossBoundaryTreeWidth.steps.entries()) {
        const neighbors = step.numberedNeighbors.length === 0 ? 'none' : step.numberedNeighbors.join(', ')
        lines.push(`  ${index + 1}. ${step.file}: bag size ${step.bagSize}; numbered neighbors: ${neighbors}`)
    }

    return lines.join('\n')
}

describe('cross-boundary complexity metric', () => {
    it('systems package boundary surface stays within measured complexity budgets', async () => {
        const packages = await discoverPackages()
        const graph = await buildFileImportGraph(packages)
        const report = computeBoundaryComplexity(graph, packages.map(pkg => pkg.dirName))
        const formatted = formatReport(report)

        console.info(formatted)

        expect(report.maxBoundaryWidthRatio, formatted).toBeLessThanOrEqual(MAX_BOUNDARY_WIDTH_RATIO_BUDGET)
        expect(report.crossBoundaryTreeWidth.treeWidth, formatted).toBeLessThanOrEqual(CROSS_BOUNDARY_TREE_WIDTH_BUDGET)
    })
})
