import type {GraphMetrics} from './graphMetrics'

export type FormatChoice = 'tree-cover' | 'ascii-lossy' | 'recursive-ascii' | 'mermaid' | 'edgelist'

export interface FormatDecision {
    readonly format: FormatChoice
    readonly metrics: {
        readonly arboricity: number
        readonly planar: boolean
        readonly sccCount: number
        readonly kCore: number
        readonly nodeCount: number
        readonly edgeCount: number
    }
    readonly rationale: string
}

/**
 * Decision tree (in priority order).
 * Thresholds are calibrated against greedy forest decomposition upper bounds from BF-198 fixtures:
 *   a1-tree=1, a2-cycle=2, k5-core=3, k9-core=6, k15-core=11.
 * These are higher than Nash-Williams exact values (5, 8 respectively) because the greedy
 * algorithm is an upper bound, not exact.
 *
 *   1. nodeCount < 20              → recursive-ascii  (small, readable directly)
 *   2. a(G) ≤ 3 AND planar heurist → tree-cover       (lossless per BF-192)
 *   3. a(G) ≤ 7                    → ascii-lossy      (sparse-to-moderate cross-linked)
 *   4. kCore ≥ 8                   → edgelist         (extremely tangled core)
 *   5. default                     → mermaid          (medium-dense directed graph)
 *
 * Planarity: E ≤ 3N-6 necessary condition only (conservative shortcut).
 * May classify sparse overall graphs as "planar" even when they contain non-planar subgraphs.
 */
export function selectFormat(metrics: GraphMetrics): FormatDecision {
    const {nodeCount, edgeCount, arboricity, planar, sccCount, kCore} = metrics
    const m = {arboricity, planar, sccCount, kCore, nodeCount, edgeCount}

    if (nodeCount < 20) {
        return {format: 'recursive-ascii', metrics: m,
            rationale: `n=${nodeCount}<20 ⟹ small graph, recursive-ascii maximises readability`}
    }
    if (arboricity <= 3 && planar) {
        return {format: 'tree-cover', metrics: m,
            rationale: `a(G)=${arboricity}≤3 and planar (E≤3N−6 heuristic) ⟹ tree-cover is lossless (BF-192)`}
    }
    if (arboricity <= 7) {
        return {format: 'ascii-lossy', metrics: m,
            rationale: `a(G)=${arboricity}∈(3,7] ⟹ sparse-to-moderate cross-links, ascii-lossy with [Cross-Links] footer`}
    }
    if (kCore >= 8) {
        return {format: 'edgelist', metrics: m,
            rationale: `a(G)=${arboricity}>7 and kCore=${kCore}≥8 ⟹ extremely tangled, raw edgelist most faithful`}
    }
    return {format: 'mermaid', metrics: m,
        rationale: `a(G)=${arboricity}>7, kCore=${kCore}<8 ⟹ medium-dense directed graph, mermaid shows structure`}
}

/**
 * Build the self-describing header block for a format emission.
 * For edgelist JSON, use the _meta field approach instead (see autoView.ts).
 */
export function buildAutoHeader(decision: FormatDecision, commentChar = '#'): string {
    const {format, metrics, rationale} = decision
    const {nodeCount: N, edgeCount: E, arboricity: a, planar, sccCount, kCore} = metrics
    const c = commentChar
    return [
        `${c} format: ${format} (auto-selected)`,
        `${c} metrics: N=${N} E=${E} a(G)=${a} planar=${planar} sccCount=${sccCount} kCore=${kCore}`,
        `${c} rationale: ${rationale}`,
    ].join('\n')
}
