/**
 * Shape-aware polyomino BFS separation for overlapping components.
 *
 * Two-pass sequential-stamp algorithm:
 * PASS 1 (descending area): stamp non-overlapping components onto grid
 * PASS 2 (ascending area): BFS-search for nearest free position for
 *   overlapping components, with MTV fallback if BFS exceeds radius cap.
 *
 * Extracted from packComponents.ts — separation is a distinct concern
 * from the R-tree based compact packing algorithm.
 */

import {
    createSpatialIndex,
    insertNode,
    queryNodesInRect,
} from '@/pure/graph/spatial'
import type { Rect, SpatialIndex, SpatialNodeEntry } from '@/pure/graph/spatial'
import {
    createGrid, rasterizeComponent, stampCells,
    polyominoFitsAt, bfsNearestFree
} from './polyominoGrid'
import type { CellSet, PolyominoGrid } from './polyominoGrid'
import { computeComponentBBox } from './packComponents'
import type { ComponentSubgraph, PackResult } from './packComponents'

// ============================================================================
// Constants
// ============================================================================

/** Minimum gap between separated component bounding boxes (px). */
const SPACING: number = 50

/** World pixels per grid cell for polyomino rasterization. ~1 edge length (350px). */
const GRID_STEP: number = 400

/** Maximum BFS search radius (in grid cells) for polyomino relocation. 25 × 400px = 10 000px. */
const MAX_BFS_RADIUS: number = 25

// ============================================================================
// Internal types
// ============================================================================

interface Shift {
    readonly dx: number
    readonly dy: number
}

interface MtvPassResult {
    readonly shifts: readonly Shift[]
    readonly converged: boolean
}

interface OverlapPair {
    readonly i: number
    readonly j: number
}

interface PairDetectionAcc {
    readonly index: SpatialIndex
    readonly pairs: readonly OverlapPair[]
}

// ============================================================================
// Internal helpers
// ============================================================================

function rectArea(r: Rect): number {
    return Math.max(0, r.maxX - r.minX) * Math.max(0, r.maxY - r.minY)
}

// ---- MTV internals (fallback for BFS radius cap exceeded) ----

/** Run one pass of MTV overlap detection + resolution. */
function runMtvPass(
    bboxes: readonly Rect[],
    prevShifts: readonly Shift[],
): MtvPassResult {
    const shifted: readonly Rect[] = bboxes.map((bb: Rect, i: number): Rect => ({
        minX: bb.minX + prevShifts[i].dx,
        minY: bb.minY + prevShifts[i].dy,
        maxX: bb.maxX + prevShifts[i].dx,
        maxY: bb.maxY + prevShifts[i].dy,
    }))

    // Detect overlapping pairs via R-tree insert-then-query
    const componentIndices: readonly number[] = Array.from({ length: shifted.length }, (_: unknown, k: number): number => k)
    const detection: PairDetectionAcc = componentIndices.reduce(
        (acc: PairDetectionAcc, i: number): PairDetectionAcc => {
            // Pad query rect by SPACING/2 so components end up SPACING apart
            const padded: Rect = {
                minX: shifted[i].minX - SPACING / 2,
                minY: shifted[i].minY - SPACING / 2,
                maxX: shifted[i].maxX + SPACING / 2,
                maxY: shifted[i].maxY + SPACING / 2,
            }
            const collisions: readonly SpatialNodeEntry[] = queryNodesInRect(acc.index, padded)
            const newPairs: readonly OverlapPair[] = collisions.map(
                (hit: SpatialNodeEntry): OverlapPair => ({
                    i,
                    j: parseInt(hit.nodeId.slice(5), 10),
                }),
            )
            // Mutate index (intentional: owned by this call stack, same pattern as packComponents)
            insertNode(acc.index, { nodeId: `comp-${i}`, ...shifted[i] })
            return { index: acc.index, pairs: [...acc.pairs, ...newPairs] }
        },
        { index: createSpatialIndex([], []), pairs: [] },
    )

    if (detection.pairs.length === 0) {
        return { shifts: prevShifts, converged: true }
    }

    // Apply MTVs: reduce over detected pairs, accumulating shift updates immutably
    const updatedShifts: readonly Shift[] = detection.pairs.reduce(
        (shifts: readonly Shift[], pair: OverlapPair): readonly Shift[] => {
            const mtv: Shift = computeMTV(shifted[pair.i], shifted[pair.j], SPACING)
            return shifts.map((s: Shift, idx: number): Shift => {
                if (idx === pair.i) return { dx: s.dx + mtv.dx / 2, dy: s.dy + mtv.dy / 2 }
                if (idx === pair.j) return { dx: s.dx - mtv.dx / 2, dy: s.dy - mtv.dy / 2 }
                return s
            })
        },
        prevShifts,
    )

    return { shifts: updatedShifts, converged: false }
}

/**
 * Compute the Minimum Translation Vector to separate two overlapping rects.
 * Picks the axis with minimum overlap and returns just enough displacement to separate.
 */
function computeMTV(a: Rect, b: Rect, spacing: number): Shift {
    const pushRight: number = a.maxX - b.minX + spacing
    const pushLeft: number = b.maxX - a.minX + spacing
    const pushDown: number = a.maxY - b.minY + spacing
    const pushUp: number = b.maxY - a.minY + spacing
    const min: number = Math.min(pushRight, pushLeft, pushDown, pushUp)
    if (min === pushRight) return { dx: -pushRight, dy: 0 }
    if (min === pushLeft) return { dx: pushLeft, dy: 0 }
    if (min === pushDown) return { dx: 0, dy: -pushDown }
    return { dx: 0, dy: pushUp }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Separate overlapping component bboxes with minimum movement using
 * shape-aware polyomino BFS snap.
 *
 * Two-pass sequential-stamp algorithm:
 * PASS 1 (descending area): stamp non-overlapping components onto grid
 * PASS 2 (ascending area): BFS-search for nearest free position for
 *   overlapping components, with MTV fallback if BFS exceeds radius cap.
 *
 * Unlike packComponents() which rebuilds layout from scratch, this only nudges
 * overlapping components apart — non-overlapping components get zero shift.
 */
export function separateOverlappingComponents(
    components: readonly ComponentSubgraph[],
): PackResult {
    if (components.length < 2) {
        return { shifts: components.map((): { readonly dx: number; readonly dy: number } => ({ dx: 0, dy: 0 })) }
    }

    const bboxes: readonly Rect[] = components.map(computeComponentBBox)

    // Compute union bounding box of all components
    const unionBBox: Rect = bboxes.reduce(
        (acc: Rect, bb: Rect): Rect => ({
            minX: Math.min(acc.minX, bb.minX),
            minY: Math.min(acc.minY, bb.minY),
            maxX: Math.max(acc.maxX, bb.maxX),
            maxY: Math.max(acc.maxY, bb.maxY),
        }),
        { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    )

    const unionW: number = unionBBox.maxX - unionBBox.minX
    const unionH: number = unionBBox.maxY - unionBBox.minY

    // Grid setup with padding for BFS search space
    const padding: number = MAX_BFS_RADIUS * GRID_STEP  // 10 000px
    const originX: number = unionBBox.minX - padding
    const originY: number = unionBBox.minY - padding
    const gridW: number = Math.ceil((unionW + 2 * padding) / GRID_STEP)
    const gridH: number = Math.ceil((unionH + 2 * padding) / GRID_STEP)
    const grid: PolyominoGrid = createGrid(gridW, gridH)

    // Rasterize all components into cell sets
    const cellSets: readonly CellSet[] = components.map(
        (comp: ComponentSubgraph): CellSet =>
            rasterizeComponent(comp.nodes, comp.edges, GRID_STEP, originX, originY),
    )

    // Sort indices by area descending for PASS 1 (largest first)
    const indicesByAreaDesc: readonly number[] = Array.from(
        { length: components.length },
        (_: unknown, i: number): number => i,
    ).sort((a: number, b: number): number => rectArea(bboxes[b]) - rectArea(bboxes[a]))

    // PASS 1: Stamp non-overlapping components sequentially (largest first)
    // Each component is checked against already-stamped cells — avoids shared-cell flaw
    const pass1: { readonly locked: readonly number[]; readonly overlapping: readonly number[] } =
        indicesByAreaDesc.reduce(
            (acc: { readonly locked: readonly number[]; readonly overlapping: readonly number[] }, idx: number) => {
                if (polyominoFitsAt(grid, cellSets[idx], 0, 0)) {
                    stampCells(grid, cellSets[idx])
                    return { locked: [...acc.locked, idx], overlapping: acc.overlapping }
                }
                return { locked: acc.locked, overlapping: [...acc.overlapping, idx] }
            },
            { locked: [], overlapping: [] },
        )

    // Sort overlapping by area ascending for PASS 2 (smallest moved first)
    const overlappingAsc: readonly number[] = [...pass1.overlapping].sort(
        (a: number, b: number): number => rectArea(bboxes[a]) - rectArea(bboxes[b]),
    )

    // PASS 2: BFS relocate overlapping components (smallest first)
    const shiftsRecord: { readonly [key: number]: Shift | undefined } = overlappingAsc.reduce(
        (record: { readonly [key: number]: Shift | undefined }, idx: number): { readonly [key: number]: Shift | undefined } => {
            const bfsResult: { readonly col: number; readonly row: number } | null =
                bfsNearestFree(grid, cellSets[idx], 0, 0, MAX_BFS_RADIUS)

            if (bfsResult !== null) {
                const shiftedCells: CellSet = cellSets[idx].map(
                    (c: { readonly col: number; readonly row: number }): { readonly col: number; readonly row: number } => ({
                        col: c.col + bfsResult.col,
                        row: c.row + bfsResult.row,
                    }),
                )
                stampCells(grid, shiftedCells)
                return {
                    ...record,
                    [idx]: { dx: bfsResult.col * GRID_STEP, dy: bfsResult.row * GRID_STEP },
                }
            }

            // MTV fallback: BFS exceeded radius cap
            const currentShifts: readonly Shift[] = Array.from(
                { length: components.length },
                (_: unknown, i: number): Shift => record[i] ?? { dx: 0, dy: 0 },
            )
            const mtvResult: MtvPassResult = runMtvPass(bboxes, currentShifts)
            stampCells(grid, cellSets[idx])  // Stamp at original position
            return {
                ...record,
                [idx]: mtvResult.shifts[idx],
            }
        },
        {},
    )

    // Return shifts in original component order (unprocessed = zero shift)
    const shifts: readonly Shift[] = Array.from(
        { length: components.length },
        (_: unknown, i: number): Shift => shiftsRecord[i] ?? { dx: 0, dy: 0 },
    )

    return { shifts }
}
