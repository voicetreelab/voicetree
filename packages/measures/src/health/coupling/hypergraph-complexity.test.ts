import {describe, expect, it} from 'vitest'
import {discoverPackages, type PackageInfo} from '../../_shared/discovery/discover-packages'
import {buildImportGraph} from '../../_shared/graph/import-graph'
import {recordHealthMetric} from '../../_shared/writers/report-writer'

const SKILL_DOC = 'brain/workflows/engineering/architectural-complexity/fp-rearchitecting/address_measures/address-bci.md'

// ── Types ──


type SourceFile = {
    readonly absolutePath: string
    readonly relativePath: string
    readonly packageName: string
    readonly subdirectory: string
}

type DirectedFileEdge = {
    readonly from: string
    readonly to: string
    readonly fromPackage: string
    readonly toPackage: string
}

type PairMetrics = {
    readonly pair: string
    readonly srcFan: number
    readonly tgtFan: number
    readonly edgeCount: number
    readonly density: number
    readonly treeWidth: number
}

type PackageBoundary = {
    readonly packageName: string
    readonly totalFiles: number
    readonly boundaryFiles: number
    readonly boundaryRatio: number
    readonly surfaceEntropy: number
    readonly normalizedSurfaceEntropy: number
}

type SubdirCoupling = {
    readonly packageName: string
    readonly subdirectories: number
    readonly internalEdges: number
    readonly crossSubdirEdges: number
    readonly crossSubdirRatio: number
}

// ── Budgets (ratchet down over time) ──

const MAX_PAIR_TREE_WIDTH_BUDGET = 3
// Captured 2026-05-14 after widening discovery to whole repo; ratchet down later.
const MAX_BOUNDARY_RATIO_BUDGET = 1
// Captured 2026-05-14 after widening discovery to whole repo; ratchet down later.
//
// History:
//   2026-05-24: factor changed `(tw + 1)` → `max(tw - 1, 0)` (existence tax
//   dropped). Aggregate rebaselined 198.68 → 50.60.
//
//   2026-05-26 #1: factor changed `max(tw - 1, 0)` → `max(min(srcFan, tgtFan) - 1, 0)`
//   (asymmetric two-sided narrowness). Aggregate rebaselined 50.60 → 207.83.
//
//   2026-05-26 #2: pair score = narrowness × density, where
//   density = min(1, edges / (srcFan × tgtFan)). Replaces the unbounded
//   log₂(edges + 1) factor — every pair now contributes in [0, narrowness],
//   so the aggregate cannot grow indefinitely from edge count alone. Also
//   adds facade discount: edges hitting a target package's package.json
//   `exports` facade file are pre-filtered, so consumers using the facade
//   pay zero cost. Resolves TODO(bci-edge-density) and rewards the P2
//   (package-as-deep-function) pattern mechanically.
//
//   Companion `BCI_normalised = aggregate / numChargedPairs` lets the gate
//   distinguish "system grew but new pairs are deep-narrow" (normalised
//   stays flat) from "system got messier" (normalised rises).
// Captured 2026-05-26: aggregate 0.75 across 2 charged pairs, normalised 0.375.
// Tight ratchet: small headroom for noise; ratchet down as the two remaining
// mesh-shaped pairs get refactored.
const AGGREGATE_BCI_BUDGET = 1
const NORMALISED_BCI_BUDGET = 0.5

// ── Graph Construction ──

function subdirectoryOf(relToSrc: string): string {
    const firstSlash = relToSrc.indexOf('/')
    return firstSlash >= 0 ? relToSrc.slice(0, firstSlash) : '.'
}

async function buildDirectedFileGraph(packages: Parameters<typeof buildImportGraph>[0]): Promise<{files: SourceFile[], edges: DirectedFileEdge[]}> {
    const importGraph = await buildImportGraph(packages)
    const files: SourceFile[] = importGraph.files.map(f => ({
        absolutePath: f.absolutePath,
        relativePath: f.relativePath,
        packageName: f.packageName,
        subdirectory: subdirectoryOf(f.relToSrc),
    }))
    const edges: DirectedFileEdge[] = importGraph.edges.map(e => ({
        from: e.from.relativePath,
        to: e.to.relativePath,
        fromPackage: e.from.packageName,
        toPackage: e.to.packageName,
    }))
    return {files, edges}
}

// ── Pure Metric Functions ──

function shannonEntropy(counts: readonly number[]): number {
    const total = counts.reduce((s, c) => s + c, 0)
    if (total === 0) return 0
    return -counts.reduce((sum, c) => {
        if (c <= 0) return sum
        const p = c / total
        return sum + p * Math.log2(p)
    }, 0)
}

function mcsTreeWidthLowerBound(
    nodes: readonly string[],
    adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): number {
    if (nodes.length <= 1) return 0
    const numbered = new Set<string>()
    let maxWidth = 0
    for (let i = 0; i < nodes.length; i++) {
        let bestNode = ''
        let bestCount = -1
        for (const node of nodes) {
            if (numbered.has(node)) continue
            let count = 0
            for (const n of adjacency.get(node) ?? []) {
                if (numbered.has(n)) count++
            }
            if (count > bestCount) { bestCount = count; bestNode = node }
        }
        if (bestCount > 0) maxWidth = Math.max(maxWidth, bestCount)
        numbered.add(bestNode)
    }
    return maxWidth
}

function buildUndirectedAdjacency(
    nodes: readonly string[],
    edges: readonly [string, string][],
): Map<string, Set<string>> {
    const adj = new Map<string, Set<string>>()
    for (const n of nodes) adj.set(n, new Set())
    for (const [a, b] of edges) {
        adj.get(a)!.add(b)
        adj.get(b)!.add(a)
    }
    return adj
}

function computePairMetrics(pair: string, crossEdges: readonly DirectedFileEdge[]): PairMetrics {
    const srcFiles = [...new Set(crossEdges.map(e => e.from))]
    const tgtFiles = [...new Set(crossEdges.map(e => e.to))]
    const edgePairs: [string, string][] = crossEdges.map(e => [e.from, e.to])
    const density = srcFiles.length > 0 && tgtFiles.length > 0
        ? edgePairs.length / (srcFiles.length * tgtFiles.length) : 0

    const allNodes = [...new Set([...srcFiles, ...tgtFiles])]
    const adj = buildUndirectedAdjacency(allNodes, edgePairs)
    const treeWidth = mcsTreeWidthLowerBound(allNodes, adj)

    return {pair, srcFan: srcFiles.length, tgtFan: tgtFiles.length, edgeCount: edgePairs.length, density, treeWidth}
}

function computePackageBoundary(
    packageName: string,
    packageFiles: readonly SourceFile[],
    crossEdges: readonly DirectedFileEdge[],
): PackageBoundary {
    const totalFiles = packageFiles.length
    if (totalFiles === 0) return {packageName, totalFiles: 0, boundaryFiles: 0, boundaryRatio: 0, surfaceEntropy: 0, normalizedSurfaceEntropy: 0}

    const degreeCounts = new Map<string, number>()
    for (const f of packageFiles) degreeCounts.set(f.relativePath, 0)
    for (const e of crossEdges) {
        if (e.fromPackage === packageName) degreeCounts.set(e.from, (degreeCounts.get(e.from) ?? 0) + 1)
        if (e.toPackage === packageName) degreeCounts.set(e.to, (degreeCounts.get(e.to) ?? 0) + 1)
    }

    const nonZero = [...degreeCounts.values()].filter(d => d > 0)
    const boundaryFiles = nonZero.length
    const boundaryRatio = boundaryFiles / totalFiles
    const surfaceEntropy = shannonEntropy(nonZero)
    const maxEntropy = boundaryFiles > 1 ? Math.log2(boundaryFiles) : 0
    const normalizedSurfaceEntropy = maxEntropy > 0 ? surfaceEntropy / maxEntropy : 0

    return {packageName, totalFiles, boundaryFiles, boundaryRatio, surfaceEntropy, normalizedSurfaceEntropy}
}

function computeSubdirCoupling(
    packageName: string,
    packageFiles: readonly SourceFile[],
    internalEdges: readonly DirectedFileEdge[],
): SubdirCoupling {
    const subdirs = new Set(packageFiles.map(f => f.subdirectory))
    const fileToSubdir = new Map(packageFiles.map(f => [f.relativePath, f.subdirectory]))

    let crossSubdirEdges = 0
    for (const e of internalEdges) {
        const fromSubdir = fileToSubdir.get(e.from)
        const toSubdir = fileToSubdir.get(e.to)
        if (fromSubdir && toSubdir && fromSubdir !== toSubdir) crossSubdirEdges++
    }

    return {
        packageName,
        subdirectories: subdirs.size,
        internalEdges: internalEdges.length,
        crossSubdirEdges,
        crossSubdirRatio: internalEdges.length > 0 ? crossSubdirEdges / internalEdges.length : 0,
    }
}

// Per-pair Boundary Complexity score (asymmetric narrowness × density).
//
// Input edges are the CHARGED subset: edges whose target is the consumer
// package's declared facade have already been stripped. So `srcFan` /
// `tgtFan` here count only files involved in non-facade couplings.
//
// score = max(min(srcFan, tgtFan) - 1, 0) × min(1, edges / (srcFan × tgtFan))
//   - narrowness ∈ [0, ∞): the narrower side − 1; a single-facade tgt
//     (tgtFan = 1 after stripping) gives 0
//   - density ∈ [0, 1]: bipartite density bounded
//   - product ∈ [0, narrowness]
//
// Bounded per pair (no unbounded log² growth from edge count). Aggregate
// across pairs grows only with mesh-shaped, non-facade-routed coupling.
type ChargedPairScore = {
    readonly pair: string
    readonly chargedSrcFan: number
    readonly chargedTgtFan: number
    readonly chargedEdges: number
    readonly chargedDensity: number
    readonly score: number
}

function computeChargedPairScore(
    pair: string,
    pairEdges: readonly DirectedFileEdge[],
    facadeFiles: ReadonlySet<string>,
): ChargedPairScore {
    const charged = pairEdges.filter(e => !facadeFiles.has(e.to))
    if (charged.length === 0) {
        return {pair, chargedSrcFan: 0, chargedTgtFan: 0, chargedEdges: 0, chargedDensity: 0, score: 0}
    }
    const srcFan = new Set(charged.map(e => e.from)).size
    const tgtFan = new Set(charged.map(e => e.to)).size
    const edges = charged.length
    const density = Math.min(1, edges / (srcFan * tgtFan))
    const narrowness = Math.max(Math.min(srcFan, tgtFan) - 1, 0)
    return {pair, chargedSrcFan: srcFan, chargedTgtFan: tgtFan, chargedEdges: edges, chargedDensity: density, score: narrowness * density}
}

function aggregateBCI(charged: readonly ChargedPairScore[]): {aggregate: number, normalised: number} {
    const aggregate = charged.reduce((s, p) => s + p.score, 0)
    const numCharged = charged.filter(p => p.chargedEdges > 0).length
    const normalised = numCharged > 0 ? aggregate / numCharged : 0
    return {aggregate, normalised}
}

function collectFacadeFiles(packages: readonly PackageInfo[]): Set<string> {
    const out = new Set<string>()
    for (const pkg of packages) for (const f of pkg.facadeRelativePaths) out.add(f)
    return out
}

// ── Report Formatting ──

function interpretTreeWidth(tw: number): string {
    if (tw === 0) return 'trivial'
    if (tw === 1) return 'narrow'
    if (tw <= 3) return 'moderate'
    return 'tangled'
}

function formatPairTable(pairs: readonly PairMetrics[]): string {
    const lines: string[] = [
        '',
        '=== Boundary Bipartite Metrics (per package pair) ===',
        '',
        '+--------------------------------------+-----+-----+-------+---------+----+----------+',
        '| Pair                                 | Src | Tgt | Edges | Density | TW | Shape    |',
        '+--------------------------------------+-----+-----+-------+---------+----+----------+',
    ]
    for (const p of [...pairs].sort((a, b) => b.treeWidth - a.treeWidth)) {
        lines.push(
            `| ${p.pair.padEnd(36)} | ${String(p.srcFan).padStart(3)} | ${String(p.tgtFan).padStart(3)} | ${String(p.edgeCount).padStart(5)} | ${p.density.toFixed(3).padStart(7)} | ${String(p.treeWidth).padStart(2)} | ${interpretTreeWidth(p.treeWidth).padEnd(8)} |`,
        )
    }
    lines.push('+--------------------------------------+-----+-----+-------+---------+----+----------+')
    return lines.join('\n')
}

function formatBoundaryTable(boundaries: readonly PackageBoundary[]): string {
    const lines: string[] = [
        '',
        '=== Package Boundary Profiles ===',
        '',
        '+---------------------+-------+----------+--------+----------+',
        '| Package             | Files | Boundary | Ratio  | Entropy  |',
        '+---------------------+-------+----------+--------+----------+',
    ]
    for (const b of [...boundaries].sort((a, b) => b.boundaryRatio - a.boundaryRatio)) {
        lines.push(
            `| ${b.packageName.padEnd(19)} | ${String(b.totalFiles).padStart(5)} | ${String(b.boundaryFiles).padStart(8)} | ${b.boundaryRatio.toFixed(3).padStart(6)} | ${b.normalizedSurfaceEntropy.toFixed(3).padStart(8)} |`,
        )
    }
    lines.push('+---------------------+-------+----------+--------+----------+')
    lines.push('  Ratio = fraction of files touching package boundary')
    lines.push('  Entropy = normalized Shannon entropy of boundary-edge distribution (1.0 = uniform, 0.0 = concentrated)')
    return lines.join('\n')
}

function formatSubdirTable(subdirs: readonly SubdirCoupling[]): string {
    const lines: string[] = [
        '',
        '=== Subdirectory Coupling (hierarchical, within each package) ===',
        '',
        '+---------------------+------+----------+------------+--------+',
        '| Package             | Dirs | Internal | Cross-sdir | Ratio  |',
        '+---------------------+------+----------+------------+--------+',
    ]
    for (const s of [...subdirs].sort((a, b) => b.crossSubdirRatio - a.crossSubdirRatio)) {
        lines.push(
            `| ${s.packageName.padEnd(19)} | ${String(s.subdirectories).padStart(4)} | ${String(s.internalEdges).padStart(8)} | ${String(s.crossSubdirEdges).padStart(10)} | ${s.crossSubdirRatio.toFixed(3).padStart(6)} |`,
        )
    }
    lines.push('+---------------------+------+----------+------------+--------+')
    lines.push('  Ratio = fraction of within-package edges that cross subdirectory boundaries')
    return lines.join('\n')
}

function formatAggregate(
    maxTw: number,
    maxBoundaryRatio: number,
    bci: {aggregate: number, normalised: number},
    facadeCount: number,
): string {
    return [
        '',
        '=== Aggregate Boundary Complexity ===',
        '',
        `  Max pair tree-width:  ${maxTw}  (budget: ${MAX_PAIR_TREE_WIDTH_BUDGET})`,
        `  Max boundary ratio:   ${maxBoundaryRatio.toFixed(3)}  (budget: ${MAX_BOUNDARY_RATIO_BUDGET.toFixed(3)})`,
        `  BCI aggregate:        ${bci.aggregate.toFixed(2)}  (budget: ${AGGREGATE_BCI_BUDGET.toFixed(2)})`,
        `  BCI normalised:       ${bci.normalised.toFixed(3)}  (budget: ${NORMALISED_BCI_BUDGET.toFixed(3)})`,
        '',
        '  pair_score = max(min(srcFan, tgtFan) - 1, 0) × min(1, edges / (srcFan × tgtFan))',
        `  ${facadeCount} package facade file(s) stripped from cost (P2 discount)`,
        '  aggregate = Σ pair_score over charged pairs; normalised = aggregate / numChargedPairs',
        '',
    ].join('\n')
}

// ── Tests ──

describe('hypergraph boundary complexity', () => {
    it('cross-boundary coupling shape stays within structural budgets', async () => {
        const packages = await discoverPackages()
        const {files, edges} = await buildDirectedFileGraph(packages)

        const crossEdges = edges.filter(e => e.fromPackage !== e.toPackage)

        const edgesByPair = new Map<string, DirectedFileEdge[]>()
        for (const e of crossEdges) {
            const key = `${e.fromPackage} -> ${e.toPackage}`
            const list = edgesByPair.get(key)
            if (list) list.push(e)
            else edgesByPair.set(key, [e])
        }

        const pairMetrics = [...edgesByPair.entries()].map(([pair, pairEdges]) =>
            computePairMetrics(pair, pairEdges))

        const filesByPackage = new Map<string, SourceFile[]>()
        for (const f of files) {
            const list = filesByPackage.get(f.packageName)
            if (list) list.push(f)
            else filesByPackage.set(f.packageName, [f])
        }

        const boundaries = packages.map(pkg =>
            computePackageBoundary(pkg.dirName, filesByPackage.get(pkg.dirName) ?? [], crossEdges))

        const internalEdges = edges.filter(e => e.fromPackage === e.toPackage)
        const internalEdgesByPkg = new Map<string, DirectedFileEdge[]>()
        for (const e of internalEdges) {
            const list = internalEdgesByPkg.get(e.fromPackage)
            if (list) list.push(e)
            else internalEdgesByPkg.set(e.fromPackage, [e])
        }

        const subdirCouplings = packages.map(pkg =>
            computeSubdirCoupling(pkg.dirName, filesByPackage.get(pkg.dirName) ?? [], internalEdgesByPkg.get(pkg.dirName) ?? []))

        const facadeFiles = collectFacadeFiles(packages)
        const chargedScores = [...edgesByPair.entries()].map(([pair, pairEdges]) =>
            computeChargedPairScore(pair, pairEdges, facadeFiles))

        const maxTw = pairMetrics.reduce((max, p) => Math.max(max, p.treeWidth), 0)
        const maxBoundaryRatio = boundaries.reduce((max, b) => Math.max(max, b.boundaryRatio), 0)
        const bci = aggregateBCI(chargedScores)

        console.info(formatPairTable(pairMetrics))
        console.info(formatBoundaryTable(boundaries))
        console.info(formatSubdirTable(subdirCouplings))
        console.info(formatAggregate(maxTw, maxBoundaryRatio, bci, facadeFiles.size))

        const violations: string[] = []
        if (maxTw > MAX_PAIR_TREE_WIDTH_BUDGET)
            violations.push(`max pair tree-width ${maxTw} exceeds budget ${MAX_PAIR_TREE_WIDTH_BUDGET}`)
        if (maxBoundaryRatio > MAX_BOUNDARY_RATIO_BUDGET)
            violations.push(`max boundary ratio ${maxBoundaryRatio.toFixed(3)} exceeds budget ${MAX_BOUNDARY_RATIO_BUDGET.toFixed(3)}`)
        if (bci.aggregate > AGGREGATE_BCI_BUDGET)
            violations.push(`aggregate BCI ${bci.aggregate.toFixed(2)} exceeds budget ${AGGREGATE_BCI_BUDGET.toFixed(2)}`)
        if (bci.normalised > NORMALISED_BCI_BUDGET)
            violations.push(`normalised BCI ${bci.normalised.toFixed(3)} exceeds budget ${NORMALISED_BCI_BUDGET.toFixed(3)}`)

        await recordHealthMetric({
            metricId: 'hypergraph-pair-treewidth',
            metricName: 'Hypergraph Pair Tree-Width',
            description: 'Maximum tree-width of cross-package file import pairs.',
            category: 'Coupling',
            current: maxTw,
            budget: MAX_PAIR_TREE_WIDTH_BUDGET,
            comparison: 'lte',
            unit: 'width',
            details: {pairMetrics},
        })
        await recordHealthMetric({
            metricId: 'hypergraph-boundary-ratio',
            metricName: 'Hypergraph Boundary Ratio',
            description: 'Maximum package boundary ratio across directed cross-package imports.',
            category: 'Coupling',
            current: maxBoundaryRatio,
            budget: MAX_BOUNDARY_RATIO_BUDGET,
            comparison: 'lte',
            unit: 'ratio',
            details: {boundaries},
        })
        await recordHealthMetric({
            metricId: 'hypergraph-bci',
            metricName: 'Hypergraph Boundary Complexity Index',
            description: 'Aggregate boundary complexity index over cross-package import pairs.',
            category: 'Coupling',
            current: bci.aggregate,
            budget: AGGREGATE_BCI_BUDGET,
            comparison: 'lte',
            unit: 'score',
            details: {
                pairMetrics,
                chargedScores,
                boundaries,
                subdirCouplings,
                normalised: bci.normalised,
                normalisedBudget: NORMALISED_BCI_BUDGET,
                facadeFiles: [...facadeFiles].sort(),
                violations,
            },
        })

        const debuggingHint =
            'Worst BCI contributors live in `details.chargedScores` of health-dashboard/reports/hypergraph-bci.json. ' +
            "Rank them with: jq '.details.chargedScores | sort_by(-.score) | .[0:10]' health-dashboard/reports/hypergraph-bci.json"

        expect(violations, `${violations.join('\n')}\n${debuggingHint}\nSee: ${SKILL_DOC}`).toEqual([])
    })
})
