/**
 * DSM (Design Structure Matrix) upper-triangularity per sibling-group.
 *
 * Builds the directed DSM:
 *   rows / cols = communities sharing a parent
 *   cell[i, j]  = 1 iff community i imports from community j
 *
 * Orders communities by a topological sort of their condensation (each
 * strongly-connected component collapses to one node, topological sort
 * over the resulting DAG, then expand). Components are expanded in
 * lexicographic order — keeps the ordering stable across runs.
 *
 * After ordering:
 *   - Cells below the diagonal = back-edges = cyclic dependency signal.
 *   - Compression ratio = non-zero cells / max possible cells.
 *     A clean tiered architecture lands at a fraction of the dense cap.
 *
 * Gate scoring:
 *   Score per touched community = number of below-diagonal cells in the
 *   community's row across its sibling-group's matrix. > 0 → fail
 *   (any back-edge means the parent's communities form a cycle).
 *
 * Fix patterns:
 *   - Pattern 1 (core/shell): core depends only inward.
 *   - Pattern 5 (pipeline): A→B→C is naturally upper-triangular.
 *   - P3 (tier-ordered packages): ports depend on nothing; adapters on
 *     ports; shells on adapters.
 *
 * needsInbound = true:
 *   To detect a back-edge from community X to community Y in the same
 *   parent, we need every edge — including those FROM other-community
 *   files in the subgraph back INTO the touched community. The subgraph
 *   extractor's default-outbound-only mode would miss those edges, so we
 *   opt in.
 *
 * needsTsMorph = false: edge list arithmetic only.
 */
import {siblingGroupParent} from '../../../_shared/community/community-at-depth.ts'
import type {Edge, SourceFile} from '../../../_shared/graph/import-graph.ts'
import {registerMeasure} from '../../_internal/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'

export const MEASURE_ID = 'dsm-upper-triangular'

/**
 * Any non-zero back-edge count fails the gate. (We have no warn tier;
 * a back-edge means a cycle exists in the parent's community DAG.)
 */
/**
 * Single per-measure threshold (replaces the old per-community baseline
 * ratchet). Strict zero-tolerance — matches the old `DSM_BACKEDGE_BUDGET = 0`
 * absolute. A below-diagonal cell is a tier-order violation by construction.
 * 9 grandfathered communities have backedges > 0 and now fail when touched;
 * fix the order rather than persist via baseline.
 */
export const DSM_BACKEDGE_THRESHOLD = 0

export type DsmReport = {
    readonly ordering: readonly string[]
    /** matrix[from][to] = count of edges from community ordering[from] → ordering[to]. */
    readonly matrix: readonly (readonly number[])[]
    readonly belowDiagonalCells: number
    readonly nonZeroCells: number
    /** non-zero cells / (n^2 − n) for an n-community parent; n ≤ 1 → 0. */
    readonly compressionRatio: number
}

type CommunityDsm = {
    readonly parent: string
    readonly report: DsmReport
    /** belowDiagonal[community] = count of cells in that community's row that lie below the diagonal. */
    readonly belowDiagonalByCommunity: ReadonlyMap<string, number>
}

/**
 * Tarjan-style SCC + topological-order condensation.
 *
 * Pure: takes nodes + adjacency, returns ordered list of communities
 * (cycles broken by lexicographic order within each SCC).
 */
export function orderCommunitiesTopologically(
    nodes: readonly string[],
    edges: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
    const sccs = tarjanScc(nodes, edges)
    const sccIdx = new Map<string, number>()
    sccs.forEach((scc, i) => scc.forEach(n => sccIdx.set(n, i)))

    // Build condensation: SCC index → SCC indexes it points to (excluding self).
    const condEdges = new Map<number, Set<number>>()
    for (let i = 0; i < sccs.length; i++) condEdges.set(i, new Set())
    for (const [from, tos] of edges) {
        const f = sccIdx.get(from)
        if (f === undefined) continue
        for (const to of tos) {
            const t = sccIdx.get(to)
            if (t === undefined || t === f) continue
            condEdges.get(f)!.add(t)
        }
    }

    // Topological sort over the SCC DAG via Kahn's algorithm.
    // Deterministic tiebreak: among ready SCCs, pick the one whose
    // lexicographically-smallest member sorts first.
    const indegree = new Map<number, number>()
    for (let i = 0; i < sccs.length; i++) indegree.set(i, 0)
    for (const tos of condEdges.values()) {
        for (const t of tos) indegree.set(t, (indegree.get(t) ?? 0) + 1)
    }
    const sccMin = sccs.map(scc => [...scc].sort()[0])
    const ready: number[] = []
    for (let i = 0; i < sccs.length; i++) if (indegree.get(i) === 0) ready.push(i)
    ready.sort((a, b) => sccMin[a].localeCompare(sccMin[b]))

    const order: number[] = []
    while (ready.length > 0) {
        const next = ready.shift()!
        order.push(next)
        for (const t of condEdges.get(next) ?? []) {
            const d = (indegree.get(t) ?? 0) - 1
            indegree.set(t, d)
            if (d === 0) {
                // Insert sorted.
                const tMin = sccMin[t]
                let i = 0
                while (i < ready.length && sccMin[ready[i]].localeCompare(tMin) < 0) i++
                ready.splice(i, 0, t)
            }
        }
    }
    // Any indegree>0 left means cycles (impossible in condensation) — defensive.
    for (let i = 0; i < sccs.length; i++) if (!order.includes(i)) order.push(i)

    // Expand each SCC lexicographically.
    return order.flatMap(i => [...sccs[i]].sort())
}

function tarjanScc(
    nodes: readonly string[],
    edges: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
    let nextIndex = 0
    const index = new Map<string, number>()
    const lowLink = new Map<string, number>()
    const onStack = new Set<string>()
    const stack: string[] = []
    const sccs: string[][] = []

    const strongconnect = (v: string): void => {
        index.set(v, nextIndex)
        lowLink.set(v, nextIndex)
        nextIndex++
        stack.push(v)
        onStack.add(v)

        for (const w of edges.get(v) ?? []) {
            if (!index.has(w)) {
                strongconnect(w)
                lowLink.set(v, Math.min(lowLink.get(v)!, lowLink.get(w)!))
            } else if (onStack.has(w)) {
                lowLink.set(v, Math.min(lowLink.get(v)!, index.get(w)!))
            }
        }

        if (lowLink.get(v) === index.get(v)) {
            const scc: string[] = []
            while (true) {
                const w = stack.pop()!
                onStack.delete(w)
                scc.push(w)
                if (w === v) break
            }
            sccs.push(scc)
        }
    }

    for (const v of nodes) if (!index.has(v)) strongconnect(v)
    return sccs
}

/**
 * Build the DSM and back-edge counts for one sibling group.
 *
 * Pure: no I/O, no side effects.
 */
export function dsmForSiblingGroup(
    communities: readonly string[],
    edgesBetween: ReadonlyMap<string, ReadonlyMap<string, number>>,
): DsmReport {
    const adj = new Map<string, Set<string>>()
    for (const c of communities) adj.set(c, new Set())
    for (const [from, tos] of edgesBetween) {
        for (const [to] of tos) {
            if (from === to) continue
            adj.get(from)?.add(to)
        }
    }
    const ordering = orderCommunitiesTopologically(communities, adj)
    const idx = new Map(ordering.map((c, i) => [c, i]))

    const n = ordering.length
    const matrix: number[][] = Array.from({length: n}, () => Array(n).fill(0))
    for (const [from, tos] of edgesBetween) {
        const i = idx.get(from)
        if (i === undefined) continue
        for (const [to, count] of tos) {
            const j = idx.get(to)
            if (j === undefined || j === i) continue
            matrix[i][j] += count
        }
    }

    let belowDiagonal = 0
    let nonZero = 0
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            if (i === j) continue
            if (matrix[i][j] === 0) continue
            nonZero++
            if (i > j) belowDiagonal++
        }
    }

    const cellCap = n * n - n
    return {
        ordering,
        matrix,
        belowDiagonalCells: belowDiagonal,
        nonZeroCells: nonZero,
        compressionRatio: cellCap === 0 ? 0 : nonZero / cellCap,
    }
}

function buildPerParentDsms(
    files: readonly SourceFile[],
    edges: readonly Edge[],
    communityMap: ReadonlyMap<string, string>,
    depth: number,
): Map<string, CommunityDsm> {
    const communitiesByParent = new Map<string, Set<string>>()
    for (const f of files) {
        const c = communityMap.get(f.absolutePath)
        if (!c) continue
        const p = siblingGroupParent(c, depth)
        if (!communitiesByParent.has(p)) communitiesByParent.set(p, new Set())
        communitiesByParent.get(p)!.add(c)
    }

    const out = new Map<string, CommunityDsm>()
    for (const [parent, commSet] of communitiesByParent) {
        if (commSet.size < 2) continue
        const communities = [...commSet].sort()

        // Build edge counts limited to this parent's communities.
        const edgesBetween = new Map<string, Map<string, number>>()
        for (const c of communities) edgesBetween.set(c, new Map())
        for (const e of edges) {
            const fc = communityMap.get(e.from.absolutePath)
            const tc = communityMap.get(e.to.absolutePath)
            if (!fc || !tc) continue
            if (siblingGroupParent(fc, depth) !== parent) continue
            if (siblingGroupParent(tc, depth) !== parent) continue
            if (fc === tc) continue
            const row = edgesBetween.get(fc)!
            row.set(tc, (row.get(tc) ?? 0) + 1)
        }

        const report = dsmForSiblingGroup(communities, edgesBetween)
        // Per-community below-diagonal count.
        const belowByCommunity = new Map<string, number>()
        report.ordering.forEach((community, i) => {
            let count = 0
            for (let j = 0; j < i; j++) {
                if (report.matrix[i][j] !== 0) count++
            }
            belowByCommunity.set(community, count)
        })

        out.set(parent, {parent, report, belowDiagonalByCommunity: belowByCommunity})
    }
    return out
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const perParent = buildPerParentDsms(
        parsedSubgraph.files,
        parsedSubgraph.edges,
        parsedSubgraph.communityMap,
        parsedSubgraph.depth,
    )

    const perCommunity: Record<string, number> = {}
    for (const community of parsedSubgraph.touchedCommunities) {
        const parent = siblingGroupParent(community, parsedSubgraph.depth)
        const dsm = perParent.get(parent)
        perCommunity[community] = dsm?.belowDiagonalByCommunity.get(community) ?? 0
    }

    const violations: Violation[] = []
    for (const community of parsedSubgraph.touchedCommunities) {
        const current = perCommunity[community]
        if (current <= DSM_BACKEDGE_THRESHOLD) continue
        const parent = siblingGroupParent(community, parsedSubgraph.depth)
        const dsm = perParent.get(parent)!
        violations.push({
            community,
            score: current,
            baseline: null,
            severity: 'fail',
            message: `dsm-upper-triangular: ${current} below-diagonal cell(s) in ${parent} (compression ratio ${dsm.report.compressionRatio.toFixed(2)}) > threshold ${DSM_BACKEDGE_THRESHOLD} — cycle in tier order`,
        })
    }
    return {measureId: MEASURE_ID, perCommunity, violations}
}

export const dsmUpperTriangularMeasure: SubgraphMeasure = {
    id: MEASURE_ID,
    axis: 'structural',
    scope: 'community',
    needsTsMorph: false,
    needsInbound: true,
    run,
}

registerMeasure(dsmUpperTriangularMeasure)
