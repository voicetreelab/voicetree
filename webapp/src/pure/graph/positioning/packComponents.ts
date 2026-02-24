/**
 * R-tree based component packing algorithm.
 *
 * Pure function: takes component subgraphs, returns bounding-box shift vectors
 * that pack disconnected components into a compact layout. Replaces polyomino
 * grid packing with O(log n) R-tree collision checks.
 *
 * Contract matches cytoscape-layout-utilities packComponents:
 *   packComponents(subgraphs) → { shifts: [{dx, dy}] }
 *
 * Algorithm:
 * 1. Compute bounding box per component (from nodes + edges)
 * 2. Sort by area descending (largest first)
 * 3. Place largest at origin
 * 4. For each remaining: generate candidate positions around packed frontier,
 *    collision-check via R-tree, score by (fullness + aspect ratio), place best
 * 5. Return shifts = newPosition - originalPosition per component
 */

import {
    createSpatialIndex,
    hasNodeCollision,
    insertNode,
} from '@/pure/graph/spatial'
import type { Rect, SpatialIndex, SpatialNodeEntry } from '@/pure/graph/spatial'

// ============================================================================
// Public contract (mirrors polyomino packComponents)
// ============================================================================

export type ComponentSubgraph = {
    readonly nodes: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[]
    readonly edges: readonly { readonly startX: number; readonly startY: number; readonly endX: number; readonly endY: number }[]
}

export type PackResult = { readonly shifts: readonly { readonly dx: number; readonly dy: number }[] }

/**
 * Check whether any component bounding boxes overlap.
 * Uses an R-tree for O(n log n) pairwise overlap detection: inserts bboxes
 * one-by-one, checking for collision before each insert.
 * Returns true if any pair of component bboxes intersect.
 */
export function componentsOverlap(components: readonly ComponentSubgraph[]): boolean {
    if (components.length < 2) return false
    const bboxes: readonly Rect[] = components.map(computeComponentBBox)
    const index: SpatialIndex = createSpatialIndex([], [])
    return bboxes.some((bb: Rect, i: number): boolean => {
        if (hasNodeCollision(index, bb)) return true
        insertNode(index, { nodeId: `comp-${i}`, ...bb })
        return false
    })
}

export { separateOverlappingComponents } from './separateOverlapping'

// ============================================================================
// Constants
// ============================================================================

/** Minimum gap between packed component bounding boxes (px). */
const SPACING: number = 50

/** Scoring weight for packing density (0–1). */
const FULLNESS_WEIGHT: number = 0.7

/** Scoring weight for aspect ratio proximity to 1.0 (0–1). */
const ASPECT_WEIGHT: number = 0.3

// ============================================================================
// Internal types
// ============================================================================

interface BBoxAcc {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
}

interface Candidate {
    readonly x: number
    readonly y: number
}

interface Shift {
    readonly dx: number
    readonly dy: number
}

interface BestAcc {
    readonly x: number
    readonly y: number
    readonly score: number
}

/** Accumulated state for the greedy component placement reduce. */
interface PlacementState {
    readonly placedBBoxes: readonly Rect[]
    readonly frontier: Rect
    readonly runningTotalArea: number
    readonly index: SpatialIndex
    readonly shiftsRecord: { readonly [key: number]: Shift | undefined }
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Compute the axis-aligned bounding box of a component from its nodes and edges.
 * Node x,y = center (cytoscape convention); edge start/end = absolute coords.
 */
export function computeComponentBBox(comp: ComponentSubgraph): Rect {
    const seed: BBoxAcc = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

    const afterNodes: BBoxAcc = comp.nodes.reduce(
        (acc: BBoxAcc, n: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): BBoxAcc => {
            const hw: number = n.width / 2
            const hh: number = n.height / 2
            return {
                minX: Math.min(acc.minX, n.x - hw),
                minY: Math.min(acc.minY, n.y - hh),
                maxX: Math.max(acc.maxX, n.x + hw),
                maxY: Math.max(acc.maxY, n.y + hh),
            }
        },
        seed,
    )

    const result: BBoxAcc = comp.edges.reduce(
        (acc: BBoxAcc, e: { readonly startX: number; readonly startY: number; readonly endX: number; readonly endY: number }): BBoxAcc => ({
            minX: Math.min(acc.minX, e.startX, e.endX),
            minY: Math.min(acc.minY, e.startY, e.endY),
            maxX: Math.max(acc.maxX, e.startX, e.endX),
            maxY: Math.max(acc.maxY, e.startY, e.endY),
        }),
        afterNodes,
    )

    // Empty component (no nodes or edges) → zero-size box at origin
    if (!isFinite(result.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    return result
}

function rectArea(r: Rect): number {
    return Math.max(0, r.maxX - r.minX) * Math.max(0, r.maxY - r.minY)
}

function rectWidth(r: Rect): number {
    return r.maxX - r.minX
}

function rectHeight(r: Rect): number {
    return r.maxY - r.minY
}

/** Expand r1 to also cover r2. O(1). */
function expandToFit(r1: Rect, r2: Rect): Rect {
    return {
        minX: Math.min(r1.minX, r2.minX),
        minY: Math.min(r1.minY, r2.minY),
        maxX: Math.max(r1.maxX, r2.maxX),
        maxY: Math.max(r1.maxY, r2.maxY),
    }
}

/**
 * Generate candidate (minX, minY) positions for a component of size (w × h)
 * adjacent to each already-placed bounding box.
 *
 * For each placed bbox: 4 cardinal sides × 3 alignment offsets = 12 candidates.
 * Alignment options: flush-start, center-aligned, flush-end.
 */
function generateCandidates(
    placedBBoxes: readonly Rect[],
    w: number,
    h: number,
): readonly Candidate[] {
    return placedBBoxes.flatMap((p: Rect): readonly Candidate[] => {
        const ph: number = rectHeight(p)
        const pw: number = rectWidth(p)
        const rx: number = p.maxX + SPACING
        const lx: number = p.minX - w - SPACING
        const by: number = p.maxY + SPACING
        const ay: number = p.minY - h - SPACING
        return [
            { x: rx, y: p.minY },
            { x: rx, y: p.minY + (ph - h) / 2 },
            { x: rx, y: p.maxY - h },
            { x: lx, y: p.minY },
            { x: lx, y: p.minY + (ph - h) / 2 },
            { x: lx, y: p.maxY - h },
            { x: p.minX, y: by },
            { x: p.minX + (pw - w) / 2, y: by },
            { x: p.maxX - w, y: by },
            { x: p.minX, y: ay },
            { x: p.minX + (pw - w) / 2, y: ay },
            { x: p.maxX - w, y: ay },
        ]
    })
}

/**
 * Score a candidate placement. Higher is better.
 * Balances packing density (fullness) with layout shape (aspect ratio near 1).
 *
 * @param totalArea - Sum of all component areas placed so far (including current).
 * @param globalBBox - Resulting bounding box if current placed here.
 */
function scoreCandidate(totalArea: number, globalBBox: Rect): number {
    const bboxArea: number = rectArea(globalBBox)
    if (bboxArea === 0) return 0

    const fullness: number = totalArea / bboxArea
    const w: number = rectWidth(globalBBox)
    const h: number = rectHeight(globalBBox)
    const longer: number = Math.max(w, h)
    const shorter: number = Math.max(Math.min(w, h), 1)
    const aspectRatio: number = longer / shorter

    return FULLNESS_WEIGHT * fullness + ASPECT_WEIGHT * (1 / aspectRatio)
}

/**
 * Place one component into the layout, returning updated placement state.
 * Uses reduce over candidates to find best collision-free position. Fallback
 * is right of packed frontier if all candidates collide (extremely rare).
 */
function placeOneComponent(state: PlacementState, origIdx: number, origBBoxes: readonly Rect[]): PlacementState {
    const origBBox: Rect = origBBoxes[origIdx]
    const w: number = rectWidth(origBBox)
    const h: number = rectHeight(origBBox)
    const thisArea: number = rectArea(origBBox)
    const candidateTotalArea: number = state.runningTotalArea + thisArea
    const candidates: readonly Candidate[] = generateCandidates(state.placedBBoxes, w, h)

    // Fallback initial: place to the right of frontier at y=0 (score -Infinity means any valid placement wins)
    const fallback: BestAcc = { x: state.frontier.maxX + SPACING, y: 0, score: -Infinity }

    const best: BestAcc = candidates.reduce(
        (acc: BestAcc, cand: Candidate): BestAcc => {
            const candidateRect: Rect = {
                minX: cand.x,
                minY: cand.y,
                maxX: cand.x + w,
                maxY: cand.y + h,
            }
            if (!hasNodeCollision(state.index, candidateRect)) {
                // O(1): expand precomputed frontier rather than iterating placedBBoxes
                const newGlobal: Rect = expandToFit(state.frontier, candidateRect)
                const score: number = scoreCandidate(candidateTotalArea, newGlobal)
                if (score > acc.score) {
                    return { x: cand.x, y: cand.y, score }
                }
            }
            return acc
        },
        fallback,
    )

    const placedRect: Rect = {
        minX: best.x,
        minY: best.y,
        maxX: best.x + w,
        maxY: best.y + h,
    }

    // Mutate the shared R-tree (intentional: index is owned by packComponents call stack)
    const entry: SpatialNodeEntry = { nodeId: `comp-${origIdx}`, ...placedRect }
    insertNode(state.index, entry)

    return {
        placedBBoxes: [...state.placedBBoxes, placedRect],
        frontier: expandToFit(state.frontier, placedRect),
        runningTotalArea: state.runningTotalArea + thisArea,
        index: state.index,
        shiftsRecord: {
            ...state.shiftsRecord,
            [origIdx]: { dx: best.x - origBBox.minX, dy: best.y - origBBox.minY },
        },
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Pack component subgraphs into a compact layout using R-tree collision detection.
 *
 * Input: array of component subgraphs (nodes with center-based x,y,width,height;
 * edges with absolute start/end coords).
 * Output: shift vector per component in the same order as input.
 */
export function packComponents(components: readonly ComponentSubgraph[]): PackResult {
    if (components.length === 0) return { shifts: [] }
    if (components.length === 1) return { shifts: [{ dx: 0, dy: 0 }] }

    // 1. Compute bounding boxes (x,y = center per cytoscape convention)
    const origBBoxes: readonly Rect[] = components.map(computeComponentBBox)

    // 2. Sort indices by area descending (largest first)
    const sortedIndices: readonly number[] = Array.from(
        { length: components.length },
        (_: unknown, i: number): number => i,
    ).sort((a: number, b: number): number => rectArea(origBBoxes[b]) - rectArea(origBBoxes[a]))

    // 3. Place first (largest) component with its top-left at origin
    const firstIdx: number = sortedIndices[0]
    const firstOrig: Rect = origBBoxes[firstIdx]
    const firstW: number = rectWidth(firstOrig)
    const firstH: number = rectHeight(firstOrig)
    const firstPlaced: Rect = { minX: 0, minY: 0, maxX: firstW, maxY: firstH }

    const firstEntry: SpatialNodeEntry = { nodeId: `comp-${firstIdx}`, ...firstPlaced }
    const initialIndex: SpatialIndex = createSpatialIndex([firstEntry], [])

    const initialState: PlacementState = {
        placedBBoxes: [firstPlaced],
        frontier: firstPlaced,
        runningTotalArea: rectArea(firstOrig),
        index: initialIndex,
        shiftsRecord: { [firstIdx]: { dx: -firstOrig.minX, dy: -firstOrig.minY } },
    }

    // 4. Greedily place remaining components via reduce (avoids let/for-loop)
    const finalState: PlacementState = sortedIndices
        .slice(1)
        .reduce(
            (state: PlacementState, origIdx: number): PlacementState =>
                placeOneComponent(state, origIdx, origBBoxes),
            initialState,
        )

    // 5. Reconstruct shifts in original component order
    const shifts: readonly Shift[] = Array.from(
        { length: components.length },
        (_: unknown, i: number): Shift => finalState.shiftsRecord[i] ?? { dx: 0, dy: 0 },
    )

    return { shifts }
}
