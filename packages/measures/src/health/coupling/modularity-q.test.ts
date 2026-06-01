import {readdir, readFile, stat} from 'node:fs/promises'
import {dirname, join, relative, resolve} from 'node:path'
import * as ts from 'typescript'
import {describe, expect, it} from 'vitest'
import {DEFAULT_REPO_ROOT, discoverPackages, type PackageInfo} from '../../_shared/discovery/discover-packages'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

const REPO_ROOT: string = DEFAULT_REPO_ROOT
const {minModularityQ: MODULARITY_Q_BUDGET} = readBudgetSync<{minModularityQ: number}>('coupling/modularity-q.json')


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

type PackageEdgeStats = {
    readonly internalEdges: number
    readonly externalEdges: number
}

type ModularityReport = {
    readonly q: number
    readonly edgeCount: number
    readonly packageStats: ReadonlyMap<string, PackageEdgeStats>
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
            && !path.includes('/__generated__/')
            && !path.includes('/__tests__/')) {
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
    if (basePath.endsWith('/__audit_seed__.ts')) return []
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
            dedupedEdges.add([fromFile.absolutePath, toPath].sort().join('\0'))
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

function emptyPackageStats(packageNames: readonly string[]): Map<string, PackageEdgeStats> {
    return new Map(packageNames.map(name => [name, {internalEdges: 0, externalEdges: 0}]))
}

function addPackageEdgeStat(
    stats: Map<string, PackageEdgeStats>,
    packageName: string,
    edgeType: keyof PackageEdgeStats,
): void {
    const previous = stats.get(packageName) ?? {internalEdges: 0, externalEdges: 0}
    stats.set(packageName, {...previous, [edgeType]: previous[edgeType] + 1})
}

function computeModularityQ(graph: FileImportGraph, packageNames: readonly string[]): ModularityReport {
    const edgeCount = graph.edges.length
    if (edgeCount === 0) return {q: 0, edgeCount, packageStats: emptyPackageStats(packageNames)}

    const degreeByFile = new Map(graph.nodes.map(node => [node.relativePath, 0]))
    const packageStats = emptyPackageStats(packageNames)

    for (const edge of graph.edges) {
        degreeByFile.set(edge.fromFile, (degreeByFile.get(edge.fromFile) ?? 0) + 1)
        degreeByFile.set(edge.toFile, (degreeByFile.get(edge.toFile) ?? 0) + 1)

        if (edge.fromPackage === edge.toPackage) {
            addPackageEdgeStat(packageStats, edge.fromPackage, 'internalEdges')
        } else {
            addPackageEdgeStat(packageStats, edge.fromPackage, 'externalEdges')
            addPackageEdgeStat(packageStats, edge.toPackage, 'externalEdges')
        }
    }

    const degreeSumByPackage = new Map(packageNames.map(name => [name, 0]))
    for (const node of graph.nodes) {
        degreeSumByPackage.set(node.packageName, (degreeSumByPackage.get(node.packageName) ?? 0) + (degreeByFile.get(node.relativePath) ?? 0))
    }

    const q = packageNames.reduce((sum, packageName) => {
        const internalEdges = packageStats.get(packageName)?.internalEdges ?? 0
        const degreeSum = degreeSumByPackage.get(packageName) ?? 0
        return sum + (internalEdges / edgeCount) - (degreeSum / (2 * edgeCount)) ** 2
    }, 0)

    return {q, edgeCount, packageStats}
}

function interpretModularity(q: number): string {
    if (q > 0.7) return 'very clean package clustering'
    if (q > 0.3) return 'meaningful modular structure'
    return 'weak package-boundary alignment'
}

function formatReport(report: ModularityReport): string {
    const lines: string[] = [
        '',
        `Modularity Q: ${report.q.toFixed(4)} (${interpretModularity(report.q)})`,
        `Budget: ${MODULARITY_Q_BUDGET.toFixed(4)}`,
        `Undirected file-level edges: ${report.edgeCount}`,
        '',
        '+---------------------+----------+----------+',
        '| Package             | Internal | External |',
        '+---------------------+----------+----------+',
    ]

    for (const [packageName, stats] of [...report.packageStats].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`| ${packageName.padEnd(19)} | ${String(stats.internalEdges).padStart(8)} | ${String(stats.externalEdges).padStart(8)} |`)
    }

    lines.push('+---------------------+----------+----------+')
    return lines.join('\n')
}

describe('systems package modularity', () => {
    it('package boundaries align with file-level import clusters', async () => {
        const packages = await discoverPackages()
        const graph = await buildFileImportGraph(packages)
        const report = computeModularityQ(graph, packages.map(pkg => pkg.dirName))

        console.info(formatReport(report))

        await recordHealthMetric({
            metricId: 'modularity-q',
            metricName: 'Modularity Q',
            description: 'How strongly file-level imports cluster inside current package boundaries.',
            category: 'Structure',
            current: report.q,
            budget: MODULARITY_Q_BUDGET,
            comparison: 'gte',
            unit: 'score',
            details: report,
        })

        expect(report.q).toBeGreaterThanOrEqual(MODULARITY_Q_BUDGET)
    })
})
