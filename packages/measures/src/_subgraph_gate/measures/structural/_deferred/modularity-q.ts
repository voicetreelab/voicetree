/**
 * Modularity Q (Newman) per sibling-group, evaluated on the touched
 * community(ies)' parent groups.
 *
 *   Q = Σ_c [(L_c / m) − (k_c / 2m)²]
 *
 *   L_c = intra-community edges in c (counted on unique undirected pairs)
 *   k_c = sum of degrees of files in c
 *   m   = total undirected edges inside the sibling group
 *
 * Gate semantics:
 *   This measure is a GATE on the directory partition itself, NOT a
 *   continuous health score. If Q drops below {@link MODULARITY_Q_FAIL}
 *   the partition is fiction — every other structural measure computed
 *   over those communities is comparing apples to fragments-of-apples.
 *   Fix is structural: garden the directories so imports cluster inside
 *   them (Pattern 1 core/shell, P2 packages-as-deep-functions, M1 deep-
 *   narrow modules).
 *
 * Per-community attribution:
 *   Q is a property of the *partition*, so we attribute the same Q to
 *   every touched community that shares a sibling-group parent. Each
 *   parent gets one Q value; touched communities inherit their parent's.
 *
 * needsInbound = true:
 *   k_c needs the degrees of every file in c, which means we must see
 *   ALL edges incident on the touched communities — not just those
 *   outbound from touched files. The gate runner unions needsInbound
 *   across measures, so opting in here adds inbound for any other
 *   measure that didn't already need it.
 *
 * needsTsMorph = false: edge list arithmetic only.
 */
import {communityAtDepth, siblingGroupParent} from '../../../../_shared/community/community-at-depth.ts'
import {computeModularityQ} from '../../../../_shared/complexity/hierarchical-complexity-measures.ts'
import type {Edge, SourceFile} from '../../../../_shared/graph/import-graph.ts'
import {loadBaseline} from '../../../../_shared/measures/baseline-store.ts'
import {registerMeasure} from '../../../../_shared/measures/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../../../_shared/measures/subgraph-measure.ts'

export const MEASURE_ID = 'modularity-q'

/**
 * Below this, the directory partition is not a meaningful module
 * boundary — fail. The 0.3 threshold matches the literature's
 * "meaningful modular structure" cutoff (anything below is noise).
 */
export const MODULARITY_Q_FAIL = 0.3

/**
 * Per-sibling-group Q, computed only for parents that contain ≥2
 * communities in the subgraph (single-community parents have no
 * intra-parent partition to evaluate).
 *
 * Exported for direct testing.
 */
export function computePerParentQ(
    files: readonly SourceFile[],
    edges: readonly Edge[],
    depth: number,
): ReadonlyMap<string, number> {
    const fileCommunities = new Map<string, string>()
    for (const f of files) {
        fileCommunities.set(f.absolutePath, communityAtDepth(f.packageName, f.relToSrc, depth))
    }
    const communitiesByParent = new Map<string, Set<string>>()
    for (const f of files) {
        const c = fileCommunities.get(f.absolutePath)!
        const p = siblingGroupParent(c, depth)
        if (!communitiesByParent.has(p)) communitiesByParent.set(p, new Set())
        communitiesByParent.get(p)!.add(c)
    }

    const out = new Map<string, number>()
    for (const [parent, commSet] of communitiesByParent) {
        if (commSet.size < 2) continue
        const intraParentEdges = edges.filter(e => {
            const fromC = fileCommunities.get(e.from.absolutePath)
            const toC = fileCommunities.get(e.to.absolutePath)
            if (!fromC || !toC) return false
            return siblingGroupParent(fromC, depth) === parent
                && siblingGroupParent(toC, depth) === parent
        })
        const communityNames = [...commSet]
        const q = computeModularityQ(intraParentEdges, fileCommunities, communityNames)
        out.set(parent, q)
    }
    return out
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const perParentQ = computePerParentQ(parsedSubgraph.files, parsedSubgraph.edges, parsedSubgraph.depth)

    const perCommunity: Record<string, number> = {}
    for (const community of parsedSubgraph.touchedCommunities) {
        const parent = siblingGroupParent(community, parsedSubgraph.depth)
        // If the parent has no sibling structure (single community), nothing
        // to evaluate — emit Q=1.0 sentinel to mean "trivially clean".
        const q = perParentQ.has(parent) ? perParentQ.get(parent)! : 1.0
        perCommunity[community] = q
    }

    const baseline = await loadBaseline(MEASURE_ID)
    const violations: Violation[] = []

    for (const community of parsedSubgraph.touchedCommunities) {
        const current = perCommunity[community]
        const baselineScore = community in baseline ? baseline[community] : null
        const parent = siblingGroupParent(community, parsedSubgraph.depth)

        if (current < MODULARITY_Q_FAIL) {
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'fail',
                message: `modularity-Q ${current.toFixed(3)} < ${MODULARITY_Q_FAIL} for parent ${parent} — directory partition is not a meaningful module boundary`,
            })
            continue
        }
        // Q is gte-better, so a regression is a decrease.
        if (baselineScore !== null && current < baselineScore) {
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'fail',
                message: `modularity-Q regressed for parent ${parent}: ${baselineScore.toFixed(3)} -> ${current.toFixed(3)}`,
            })
        }
    }

    return {measureId: MEASURE_ID, perCommunity, violations}
}

export const modularityQMeasure: SubgraphMeasure = {
    id: MEASURE_ID,
    axis: 'structural',
    scope: 'community',
    needsTsMorph: false,
    needsInbound: true,
    run,
}

registerMeasure(modularityQMeasure)
