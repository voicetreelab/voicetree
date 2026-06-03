/**
 * Graph cognitive-complexity measure (GCV — Graph Complexity Vector).
 *
 * A robust complexity measure is a VECTOR of orthogonal pillars, never a
 * weighted sum: summing orthogonal projections lets a good score on one axis
 * mask a fatal score on another. The overall `score` is therefore an L∞ —
 * the worst normalized pillar — over the *comprehension* pillars only.
 *
 * Calibrated against human ranking of directed graphs (2026-06): the dominant
 * cost is BRANCHING you cannot chunk — distributed multi-way fan-out — not
 * cycles. A long cyclic-but-linear chain reads easy; a uniform high-degree
 * mesh reads hard; a single hub reads easy (it chunks into one name). So:
 *
 *   SCORED (comprehension, feed the L∞):
 *     - branching   p90-style fan-out, hub-discounted   PRIMARY
 *     - treewidth   intrinsic branching-width / decomposability
 *     - crossings   forced 2D edge-crossings (Euler excess, bipartite-aware)
 *     - coupling    degree-entropy smear (hub vs mesh), density-gated
 *
 *   FLAG (integrity, NOT comprehension — reported beside the score):
 *     - cycles      non-trivial SCC count (recursion / no-topo-order risk)
 *
 * Cheap, layout-free, pure. No NP-hard exact computations.
 */
import {type EdgePair, computeSCCComponents} from './graphMetrics'
import {loadProjectGraph} from './graphMetrics'

export type PillarRole = 'scored' | 'flag'
export type PillarStatus = 'ok' | 'warn' | 'fail'

export interface ComplexityPillar {
    readonly id: string
    readonly label: string
    readonly value: number       // raw measured value
    readonly detail: string      // human-readable derivation
    readonly budget: number
    readonly normalized: number  // value / budget (1.0 == at budget)
    readonly role: PillarRole
    readonly status: PillarStatus
}

export type ComplexityRating = 'clean' | 'moderate' | 'heavy'

export interface GraphComplexityResult {
    readonly score: number               // L∞ over scored pillars, 2dp
    readonly rating: ComplexityRating    // from the comprehension score only
    readonly cyclic: boolean             // integrity flag — does NOT change rating
    readonly pillars: readonly ComplexityPillar[]  // the 5 composites
    readonly graph: {
        readonly nodes: number
        readonly edgesDirected: number
        readonly edgesUndirected: number
        readonly bipartite: boolean
    }
}

// Budgets — single source of truth.
export const BRANCHING_BUDGET = 3   // ~7-item working set ÷ 2 ≈ 3-way fan-out wall
export const TREEWIDTH_BUDGET = 5
export const CROSSING_RATIO_BUDGET = 0.10
export const COUPLING_BUDGET = 0.85
export const DENSITY_GATE = 1.5     // coupling smear only counts past tree density

function round2(n: number): number {
    return Math.round(n * 100) / 100
}

function statusFor(normalized: number): PillarStatus {
    if (normalized > 1) return 'fail'
    if (normalized >= 0.7) return 'warn'
    return 'ok'
}

// ── graph reductions ─────────────────────────────────────────────────────────

function outDegrees(nodeIds: readonly string[], edges: readonly EdgePair[]): Map<string, number> {
    const targets = new Map<string, Set<string>>()
    for (const n of nodeIds) targets.set(n, new Set())
    for (const {src, tgt} of edges) {
        if (src === tgt) continue
        targets.get(src)?.add(tgt)
    }
    const deg = new Map<string, number>()
    for (const [n, set] of targets) deg.set(n, set.size)
    return deg
}

function undirectedAdjacency(
    nodeIds: readonly string[],
    edges: readonly EdgePair[],
): Map<string, Set<string>> {
    const adj = new Map<string, Set<string>>()
    for (const n of nodeIds) adj.set(n, new Set())
    for (const {src, tgt} of edges) {
        if (src === tgt) continue
        adj.get(src)?.add(tgt)
        adj.get(tgt)?.add(src)
    }
    return adj
}

function undirectedEdgeCount(adjacency: ReadonlyMap<string, Set<string>>): number {
    let sum = 0
    for (const nbrs of adjacency.values()) sum += nbrs.size
    return sum / 2
}

// ── branching: hub-discounted fan-out ─────────────────────────────────────────
//
// Sort out-degrees descending, drop the top ~5% (a few hubs chunk into a name
// and are cognitively cheap), then take the max of the rest. A single hub →
// branching ≈ 1; distributed multi-way fan-out → high.
export function branchingFactor(nodeIds: readonly string[], edges: readonly EdgePair[]): number {
    if (nodeIds.length === 0) return 0
    const desc = [...outDegrees(nodeIds, edges).values()].sort((a, b) => b - a)
    const hubsToDrop = Math.max(1, Math.floor(0.05 * desc.length))
    return desc[hubsToDrop] ?? 0
}

// ── treewidth: min-degree elimination upper bound ─────────────────────────────
// Module-private: the measures package owns the public `treeWidthUpperBound`
// name; this is the graph-tools-internal copy used only by the composer.
function minDegreeTreeWidth(
    nodeIds: readonly string[],
    edges: readonly EdgePair[],
): number {
    if (nodeIds.length <= 1) return 0
    const adj = undirectedAdjacency(nodeIds, edges)
    const remaining = new Set(nodeIds)
    let bag = 0
    while (remaining.size > 0) {
        let pick = ''
        let pickDeg = Number.POSITIVE_INFINITY
        for (const v of remaining) {
            const d = adj.get(v)?.size ?? 0
            if (d < pickDeg || (d === pickDeg && v < pick)) { pick = v; pickDeg = d }
        }
        bag = Math.max(bag, pickDeg)
        const neighbors = [...(adj.get(pick) ?? [])].filter(n => remaining.has(n))
        for (const a of neighbors) {
            const adjA = adj.get(a)!
            for (const b of neighbors) { if (a !== b) adjA.add(b) }
        }
        for (const n of neighbors) adj.get(n)?.delete(pick)
        adj.delete(pick)
        remaining.delete(pick)
    }
    return bag
}

// ── bipartite test (2-colouring) ──────────────────────────────────────────────
export function isBipartite(nodeIds: readonly string[], edges: readonly EdgePair[]): boolean {
    const adj = undirectedAdjacency(nodeIds, edges)
    const colour = new Map<string, number>()
    for (const start of nodeIds) {
        if (colour.has(start)) continue
        colour.set(start, 0)
        const queue = [start]
        while (queue.length > 0) {
            const v = queue.shift()!
            const c = colour.get(v)!
            for (const n of adj.get(v) ?? []) {
                if (!colour.has(n)) { colour.set(n, c ^ 1); queue.push(n) }
                else if (colour.get(n) === c) return false
            }
        }
    }
    return true
}

// ── crossing pressure: Euler excess, bipartite-aware ──────────────────────────
//
// Planar ⟺ E ≤ 3V−6 (general) or E ≤ 2V−4 (bipartite: no triangles). The excess
// is a guaranteed lower bound on the crossing number — every excess edge forces
// ≥1 crossing in any drawing. The bipartite branch matters: layered dependency
// graphs (api→core→db) are near-bipartite and the 3V−6 bound under-counts them.
export function crossingPressure(
    vertexCount: number,
    undirectedEdges: number,
    bipartite: boolean,
): number {
    if (vertexCount < 3) return 0
    const planarMax = bipartite ? Math.max(0, 2 * vertexCount - 4) : 3 * vertexCount - 6
    return Math.max(0, undirectedEdges - planarMax)
}

// ── coupling: normalized degree entropy, density-gated ────────────────────────
//
// H̃ ∈ [0,1]: 1 = uniform degrees (smeared, no nameable hub → bad); low =
// concentrated (a hub → chunkable, fine). Only a complexity signal when there
// is excess coupling to distribute, so gated on density > tree.
export function degreeEntropy(adjacency: ReadonlyMap<string, Set<string>>): number {
    const degrees = [...adjacency.values()].map(s => s.size).filter(d => d > 0)
    if (degrees.length < 2) return 0
    const total = degrees.reduce((a, b) => a + b, 0)
    if (total === 0) return 0
    let h = 0
    for (const d of degrees) {
        const p = d / total
        h -= p * Math.log2(p)
    }
    return h / Math.log2(degrees.length)
}

// ── compose ────────────────────────────────────────────────────────────────

export function computeGraphComplexity(
    nodeIds: readonly string[],
    edges: readonly EdgePair[],
): GraphComplexityResult {
    const V = nodeIds.length
    const adj = undirectedAdjacency(nodeIds, edges)
    const Eu = undirectedEdgeCount(adj)
    const directedCount = new Set(edges.filter(e => e.src !== e.tgt).map(e => `${e.src} ${e.tgt}`)).size
    const bipartite = isBipartite(nodeIds, edges)

    const br = branchingFactor(nodeIds, edges)
    const tw = minDegreeTreeWidth(nodeIds, edges)
    const xp = crossingPressure(V, Eu, bipartite)
    const xpRatio = Eu > 0 ? xp / Eu : 0
    const densityActive = V > 0 && Eu / V > DENSITY_GATE
    const hTilde = degreeEntropy(adj)
    const couplingNorm = densityActive ? hTilde / COUPLING_BUDGET : 0
    const nonTrivialSccs = computeSCCComponents(nodeIds, edges).filter(c => c.length > 1).length

    const brNorm = br / BRANCHING_BUDGET
    const twNorm = tw / TREEWIDTH_BUDGET
    const xpNorm = xpRatio / CROSSING_RATIO_BUDGET

    const pillars: ComplexityPillar[] = [
        {
            id: 'branching', label: 'Branching', value: br,
            detail: `p90 fan-out (hub-discounted); budget ${BRANCHING_BUDGET}`,
            budget: BRANCHING_BUDGET, normalized: round2(brNorm), role: 'scored', status: statusFor(brNorm),
        },
        {
            id: 'treewidth', label: 'Treewidth', value: tw,
            detail: `min-degree elimination upper bound; budget ${TREEWIDTH_BUDGET}`,
            budget: TREEWIDTH_BUDGET, normalized: round2(twNorm), role: 'scored', status: statusFor(twNorm),
        },
        {
            id: 'crossings', label: 'Crossings', value: xp,
            detail: `Euler excess E−(${bipartite ? '2V−4' : '3V−6'})=${xp}, ratio ${round2(xpRatio)}; budget ${CROSSING_RATIO_BUDGET}`,
            budget: CROSSING_RATIO_BUDGET, normalized: round2(xpNorm), role: 'scored', status: statusFor(xpNorm),
        },
        {
            id: 'coupling', label: 'Coupling', value: round2(hTilde),
            detail: densityActive
                ? `degree-entropy H̃=${round2(hTilde)} (density ${round2(Eu / Math.max(1, V))} > ${DENSITY_GATE}); budget ${COUPLING_BUDGET}`
                : `H̃=${round2(hTilde)} suppressed (density ${round2(Eu / Math.max(1, V))} ≤ ${DENSITY_GATE})`,
            budget: COUPLING_BUDGET, normalized: round2(couplingNorm), role: 'scored', status: statusFor(couplingNorm),
        },
        {
            id: 'cycles', label: 'Cycles', value: nonTrivialSccs,
            detail: 'non-trivial SCCs — integrity flag (recursion / no topo-order), not comprehension cost',
            budget: 0, normalized: nonTrivialSccs, role: 'flag', status: nonTrivialSccs > 0 ? 'fail' : 'ok',
        },
    ]

    const score = round2(Math.max(brNorm, twNorm, xpNorm, couplingNorm))
    const rating: ComplexityRating = score > 1 ? 'heavy' : score > 0.5 ? 'moderate' : 'clean'

    return {
        score,
        rating,
        cyclic: nonTrivialSccs > 0,
        pillars,
        graph: {nodes: V, edgesDirected: directedCount, edgesUndirected: Eu, bipartite},
    }
}

export function computeComplexityFromProject(projectRoot: string): GraphComplexityResult {
    const {nodeIds, edges} = loadProjectGraph(projectRoot)
    return computeGraphComplexity(nodeIds, edges)
}
