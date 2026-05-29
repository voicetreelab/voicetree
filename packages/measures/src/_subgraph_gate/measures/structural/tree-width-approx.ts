/**
 * Cheap upper-bound treewidth via min-degree elimination ordering, per
 * touched community.
 *
 * Algorithm:
 *   1. Restrict to edges where BOTH endpoints are in the touched community,
 *      forming an undirected subgraph over the community's files.
 *   2. Repeatedly pick the lowest-degree vertex, record its degree, then
 *      "eliminate" it: connect all of its surviving neighbors pairwise
 *      (the standard fill-in step), and remove it from the graph.
 *   3. tw_upper = max degree seen during elimination.
 *
 * Why min-degree (not min-fill or treewidth-exact):
 *   - Min-degree is O(V^2) worst case and gives a true upper bound on tw,
 *     not just a heuristic. Min-fill is tighter on dense graphs but its
 *     gap-to-true-tw is what we'd be measuring rather than the property
 *     we actually want — fragility under restructuring. Min-degree is
 *     standard and predictable.
 *   - Exact treewidth is NP-hard. We deliberately accept the bound; the
 *     gate's fix-pattern signal (pipeline > mesh) is correct on the bound.
 *
 * FP fixes that drop the score:
 *   - Pattern 5 (pipeline): A→B→C→D collapses tw to 1.
 *   - Pattern 4 (ADT): replacing nested switches across a mesh of files
 *     with a single tagged-union handler removes whole rows of edges.
 *
 * needsInbound = false:
 *   Score is computed strictly inside the touched community. External
 *   importers/importees are irrelevant — what we measure is how tangled
 *   the community is internally. The subgraph extractor already passes us
 *   all edges where the FROM file is in a touched community; we filter
 *   the touched-community-internal subset here.
 *
 * needsTsMorph = false: edge list arithmetic only.
 *
 * Score interpretation:
 *   - tw = 0: 0–1 files, or no internal edges. Trivially clean.
 *   - tw = 1: tree / forest / pipeline. Ideal.
 *   - tw = 2–3: limited branching. Healthy.
 *   - tw ≥ 4: tangled; restructure required.
 *
 * Threshold:
 *   Absolute fail-safe: tw > {@link TREE_WIDTH_ABSOLUTE_BUDGET}.
 *   Baseline-delta: any regression above baseline fails (warns if no baseline).
 */
import type {Edge, SourceFile} from '../../../_shared/graph/import-graph.ts'
import {registerMeasure} from '../../_internal/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'

export const MEASURE_ID = 'tree-width-approx'

/**
 * Headline threshold. Communities with tw > 5 are pipeline-violating
 * meshes; the cost to restructure them rises super-linearly.
 */
/**
 * Single per-measure threshold (replaces the old per-community baseline
 * ratchet). Matches the old `TREE_WIDTH_ABSOLUTE_BUDGET = 5` and tier-1's
 * `TREE_WIDTH_BUDGET = 5`. This tier-0 measure is an upper-bound
 * approximation that over-estimates relative to tier-1's exact algorithm,
 * so tier-0 fires earlier than tier-1 — the intended early-warning shape.
 * Grandfathered communities at tw > 5 must reduce their tangle.
 */
export const TREE_WIDTH_THRESHOLD = 5

/**
 * Compute an upper bound on the treewidth of an undirected graph by
 * min-degree elimination ordering.
 *
 * Pure: returns an integer for any `(vertices, adjacency)` pair without
 * mutating its inputs.
 */
export function treeWidthUpperBound(
    vertices: ReadonlySet<string>,
    adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): number {
    if (vertices.size <= 1) return 0
    const remaining = new Set(vertices)
    const adj = new Map<string, Set<string>>()
    for (const v of vertices) adj.set(v, new Set(adjacency.get(v) ?? []))

    let bag = 0
    while (remaining.size > 0) {
        // Pick lowest-degree vertex (tiebreak: lexicographic — keeps deterministic).
        let pick = ''
        let pickDeg = Number.POSITIVE_INFINITY
        for (const v of remaining) {
            const d = adj.get(v)?.size ?? 0
            if (d < pickDeg || (d === pickDeg && v < pick)) {
                pick = v
                pickDeg = d
            }
        }
        bag = Math.max(bag, pickDeg)

        // Fill in: connect all neighbors pairwise.
        const neighbors = [...(adj.get(pick) ?? [])].filter(n => remaining.has(n))
        for (const a of neighbors) {
            const adjA = adj.get(a)!
            for (const b of neighbors) {
                if (a === b) continue
                adjA.add(b)
            }
        }
        // Detach `pick` from everyone.
        for (const n of neighbors) adj.get(n)?.delete(pick)
        adj.delete(pick)
        remaining.delete(pick)
    }
    return bag
}

function buildCommunityUndirectedSubgraph(
    files: readonly SourceFile[],
    edges: readonly Edge[],
    communityMap: ReadonlyMap<string, string>,
    community: string,
): {vertices: ReadonlySet<string>; adjacency: ReadonlyMap<string, ReadonlySet<string>>} {
    const vertices = new Set<string>()
    for (const f of files) {
        if (communityMap.get(f.absolutePath) === community) vertices.add(f.absolutePath)
    }
    const adjacency = new Map<string, Set<string>>()
    for (const v of vertices) adjacency.set(v, new Set())
    for (const e of edges) {
        const a = e.from.absolutePath
        const b = e.to.absolutePath
        if (!vertices.has(a) || !vertices.has(b)) continue
        if (a === b) continue
        adjacency.get(a)!.add(b)
        adjacency.get(b)!.add(a)
    }
    return {vertices, adjacency}
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const perCommunity: Record<string, number> = {}
    const widthsForViolations = new Map<string, number>()

    for (const community of parsedSubgraph.touchedCommunities) {
        const {vertices, adjacency} = buildCommunityUndirectedSubgraph(
            parsedSubgraph.files,
            parsedSubgraph.edges,
            parsedSubgraph.communityMap,
            community,
        )
        const tw = treeWidthUpperBound(vertices, adjacency)
        perCommunity[community] = tw
        widthsForViolations.set(community, tw)
    }

    const violations: Violation[] = []

    for (const community of parsedSubgraph.touchedCommunities) {
        const current = widthsForViolations.get(community)!
        if (current <= TREE_WIDTH_THRESHOLD) continue
        violations.push({
            community,
            score: current,
            baseline: null,
            severity: 'fail',
            message: `tree-width-approx ${current} > threshold ${TREE_WIDTH_THRESHOLD} (community is a tangled mesh; consider pipeline/ADT refactor)`,
        })
    }

    return {measureId: MEASURE_ID, perCommunity, violations}
}

export const treeWidthApproxMeasure: SubgraphMeasure = {
    id: MEASURE_ID,
    axis: 'structural',
    scope: 'community',
    needsTsMorph: false,
    needsInbound: false,
    run,
}

registerMeasure(treeWidthApproxMeasure)
