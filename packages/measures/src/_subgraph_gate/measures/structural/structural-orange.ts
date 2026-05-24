/**
 * Structural-orange subgraph measure: `outEdges × max(1, fanOut)` per community.
 *
 * Why:
 *   The headline structural measure. A community with high outEdges × fanOut
 *   "reaches" many siblings and pays the integration tax on every change.
 *   FP fixes that drop the score:
 *     - Pattern 1 (core/shell): pull effects to the shell so the core has
 *       narrow outbound coupling.
 *     - Pattern 4 (ADT collapses nested switches): unify N variant-branches
 *       into one tagged-union pipeline, removing N→M outEdges.
 *     - M1 / P2 (deep-narrow modules / packages-as-deep-functions): one
 *       public entry on each side, so the cross-community edge count
 *       collapses to ≈ 1.
 *
 * Delta semantics:
 *   Score = priority value from {@link computePriorityScoresAtDepth}.
 *   A community absent from the priority list (because outEdges === 0) is
 *   healthy by design; we report its score as 0 in `perCommunity`.
 *   Baseline-vs-current comparison: any `current > baseline` is a fail
 *   (the gate runner takes care of the absolute over-budget fallback).
 *
 * needsInbound = false:
 *   Score is measured strictly on outgoing intra-parent edges. Inbound
 *   importers are irrelevant. The spike proved per-community parity with
 *   the full-graph orange test for any touched community without scanning
 *   inbound edges — see _shared/complexity/orange-priority.ts header comment.
 *
 * needsTsMorph = false:
 *   Pure edge-list arithmetic; no AST required.
 */
import {
    computePriorityScoresAtDepth,
    type CommunityPriority,
} from '../../../_shared/complexity/orange-priority.ts'
import {loadBaseline} from '../../_internal/baseline-store.ts'
import {registerMeasure} from '../../_internal/registry.ts'
import type {
    SubgraphMeasure,
    SubgraphMeasureInput,
    SubgraphMeasureResult,
    Violation,
} from '../../_internal/subgraph-measure.ts'

export const MEASURE_ID = 'structural-orange'

/**
 * Hard fail-safe: if a community lands above this score the gate fails
 * even when the baseline is missing or higher. Matches the long-standing
 * tier_1 hierarchical-complexity budget (258 → ratchet down).
 */
export const STRUCTURAL_ORANGE_ABSOLUTE_BUDGET = 258

function scoreByCommunity(priorities: readonly CommunityPriority[]): ReadonlyMap<string, CommunityPriority> {
    return new Map(priorities.map(p => [p.community, p]))
}

async function run(input: SubgraphMeasureInput): Promise<SubgraphMeasureResult> {
    const {parsedSubgraph} = input
    const priorities = computePriorityScoresAtDepth(
        parsedSubgraph.files,
        parsedSubgraph.edges,
        parsedSubgraph.depth,
    )
    const byCommunity = scoreByCommunity(priorities)

    const perCommunity: Record<string, number> = {}
    for (const community of parsedSubgraph.touchedCommunities) {
        perCommunity[community] = byCommunity.get(community)?.score ?? 0
    }

    const baseline = await loadBaseline(MEASURE_ID)

    const violations: Violation[] = []
    for (const community of parsedSubgraph.touchedCommunities) {
        const current = perCommunity[community]
        const baselineScore = community in baseline ? baseline[community] : null
        const priority = byCommunity.get(community)
        const detail = priority
            ? `outEdges=${priority.outEdges} fanOut=${priority.fanOut}`
            : 'outEdges=0 fanOut=0'

        if (current > STRUCTURAL_ORANGE_ABSOLUTE_BUDGET) {
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'fail',
                message: `structural-orange score ${current} > absolute budget ${STRUCTURAL_ORANGE_ABSOLUTE_BUDGET} (${detail})`,
            })
            continue
        }
        if (baselineScore !== null && current > baselineScore) {
            violations.push({
                community,
                score: current,
                baseline: baselineScore,
                severity: 'fail',
                message: `structural-orange regressed: ${baselineScore} -> ${current} (${detail})`,
            })
        }
    }

    return {measureId: MEASURE_ID, perCommunity, violations}
}

export const structuralOrangeMeasure: SubgraphMeasure = {
    id: MEASURE_ID,
    axis: 'structural',
    scope: 'community',
    needsTsMorph: false,
    needsInbound: false,
    run,
}

registerMeasure(structuralOrangeMeasure)
