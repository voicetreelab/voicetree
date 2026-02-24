import { describe, it, expect } from 'vitest'
import { packComponents } from './packComponents'
import type { ComponentSubgraph, PackResult } from './packComponents'

// ============================================================================
// Types
// ============================================================================

interface BBox {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
}

// ============================================================================
// Helpers
// ============================================================================

/** Create a component with a single node at center (x,y) with given dimensions. */
const makeComponent: (
    x: number,
    y: number,
    w: number,
    h: number,
) => ComponentSubgraph = (x, y, w, h) => ({
    nodes: [{ x, y, width: w, height: h }],
    edges: [],
})

const SEED_BBOX: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

/** Compute the axis-aligned bounding box of a shifted component (mirrors packComponents internals). */
const shiftedBBox: (
    comp: ComponentSubgraph,
    shift: { readonly dx: number; readonly dy: number },
) => BBox = (comp, shift) => {
    const afterNodes: BBox = comp.nodes.reduce(
        (acc: BBox, n: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): BBox => {
            const hw: number = n.width / 2
            const hh: number = n.height / 2
            return {
                minX: Math.min(acc.minX, n.x - hw + shift.dx),
                minY: Math.min(acc.minY, n.y - hh + shift.dy),
                maxX: Math.max(acc.maxX, n.x + hw + shift.dx),
                maxY: Math.max(acc.maxY, n.y + hh + shift.dy),
            }
        },
        SEED_BBOX,
    )

    return comp.edges.reduce(
        (acc: BBox, e: { readonly startX: number; readonly startY: number; readonly endX: number; readonly endY: number }): BBox => ({
            minX: Math.min(acc.minX, e.startX + shift.dx, e.endX + shift.dx),
            minY: Math.min(acc.minY, e.startY + shift.dy, e.endY + shift.dy),
            maxX: Math.max(acc.maxX, e.startX + shift.dx, e.endX + shift.dx),
            maxY: Math.max(acc.maxY, e.startY + shift.dy, e.endY + shift.dy),
        }),
        afterNodes,
    )
}

/** Check if two AABBs overlap (strict — touching edges don't count). */
const aabbOverlap: (a: BBox, b: BBox) => boolean = (a, b) =>
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY

/** Minimum gap between two AABBs along the separating axis (positive = separated). */
const minAxisGap: (a: BBox, b: BBox) => number = (a, b) => {
    const gapX: number = Math.max(b.minX - a.maxX, a.minX - b.maxX)
    const gapY: number = Math.max(b.minY - a.maxY, a.minY - b.maxY)
    return Math.max(gapX, gapY)
}

/** Generate all unique (i,j) index pairs where i < j, for pairwise assertions. */
const pairwiseIndices: (count: number) => readonly (readonly [number, number])[] = (count) =>
    Array.from({ length: count }, (_: unknown, i: number): number => i).flatMap(
        (i: number): readonly (readonly [number, number])[] =>
            Array.from({ length: count - i - 1 }, (_: unknown, k: number): readonly [number, number] => [i, i + k + 1] as const),
    )

const SPACING: number = 50

// ============================================================================
// Tests
// ============================================================================

describe('packComponents', () => {
    describe('trivial inputs', () => {
        it('returns empty shifts for empty input', () => {
            const result: PackResult = packComponents([])
            expect(result.shifts).toEqual([])
        })

        it('returns [{dx:0, dy:0}] for a single component', () => {
            const result: PackResult = packComponents([makeComponent(100, 200, 80, 60)])
            expect(result.shifts).toEqual([{ dx: 0, dy: 0 }])
        })
    })

    describe('two equal-size components', () => {
        it('produces two shifts with no AABB overlap', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(50, 50, 100, 100),
                makeComponent(300, 300, 100, 100),
            ]
            const result: PackResult = packComponents(comps)

            expect(result.shifts).toHaveLength(2)
            expect(result.shifts[0]).toBeDefined()
            expect(result.shifts[1]).toBeDefined()

            const box0: BBox = shiftedBBox(comps[0], result.shifts[0])
            const box1: BBox = shiftedBBox(comps[1], result.shifts[1])
            expect(aabbOverlap(box0, box1)).toBe(false)
        })
    })

    describe('many small components (10+)', () => {
        it('packs 12 components with no pairwise overlaps', () => {
            const comps: readonly ComponentSubgraph[] = Array.from(
                { length: 12 },
                (_: unknown, i: number): ComponentSubgraph =>
                    makeComponent(i * 200, i * 200, 60, 40),
            )

            const result: PackResult = packComponents(comps)
            expect(result.shifts).toHaveLength(12)

            const boxes: readonly BBox[] = comps.map((c: ComponentSubgraph, i: number): BBox =>
                shiftedBBox(c, result.shifts[i]),
            )

            const allPairs: readonly (readonly [number, number])[] = pairwiseIndices(boxes.length)
            allPairs.forEach(([i, j]: readonly [number, number]) => {
                expect(aabbOverlap(boxes[i], boxes[j])).toBe(false)
            })
        })

        it('packs within reasonable bounds (not wildly spread)', () => {
            const comps: readonly ComponentSubgraph[] = Array.from(
                { length: 10 },
                (_: unknown, i: number): ComponentSubgraph =>
                    makeComponent(i * 500, 0, 80, 80),
            )

            const result: PackResult = packComponents(comps)
            const boxes: readonly BBox[] = comps.map((c: ComponentSubgraph, i: number): BBox =>
                shiftedBBox(c, result.shifts[i]),
            )

            const globalMinX: number = Math.min(...boxes.map((b: BBox): number => b.minX))
            const globalMinY: number = Math.min(...boxes.map((b: BBox): number => b.minY))
            const globalMaxX: number = Math.max(...boxes.map((b: BBox): number => b.maxX))
            const globalMaxY: number = Math.max(...boxes.map((b: BBox): number => b.maxY))

            const totalComponentArea: number = 10 * 80 * 80
            const globalBBoxArea: number = (globalMaxX - globalMinX) * (globalMaxY - globalMinY)

            // Packing density: total component area / global bbox area should be non-trivial
            // (not degenerately stretched into a line). Expect at least 5% density.
            expect(totalComponentArea / globalBBoxArea).toBeGreaterThan(0.05)
        })
    })

    describe('single-node component (zero size)', () => {
        it('does not crash and produces valid shifts', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(10, 10, 0, 0),
                makeComponent(20, 20, 0, 0),
            ]
            const result: PackResult = packComponents(comps)

            expect(result.shifts).toHaveLength(2)
            expect(typeof result.shifts[0].dx).toBe('number')
            expect(typeof result.shifts[0].dy).toBe('number')
            expect(Number.isFinite(result.shifts[0].dx)).toBe(true)
            expect(Number.isFinite(result.shifts[0].dy)).toBe(true)
        })
    })

    describe('components with edges extending beyond nodes', () => {
        it('bounding box includes edge endpoints', () => {
            // Node is 20x20 at center (50,50), but edge extends to (200,200)
            const compWithEdge: ComponentSubgraph = {
                nodes: [{ x: 50, y: 50, width: 20, height: 20 }],
                edges: [{ startX: 50, startY: 50, endX: 200, endY: 200 }],
            }
            const compSmall: ComponentSubgraph = makeComponent(0, 0, 30, 30)

            const result: PackResult = packComponents([compWithEdge, compSmall])
            expect(result.shifts).toHaveLength(2)

            const box0: BBox = shiftedBBox(compWithEdge, result.shifts[0])
            const box1: BBox = shiftedBBox(compSmall, result.shifts[1])

            // The first component's box should span from node to edge endpoint
            const width0: number = box0.maxX - box0.minX
            const height0: number = box0.maxY - box0.minY
            expect(width0).toBeGreaterThanOrEqual(150) // 200 - (50-10) = 160
            expect(height0).toBeGreaterThanOrEqual(150)

            expect(aabbOverlap(box0, box1)).toBe(false)
        })
    })

    describe('SPACING guarantee', () => {
        // SPACING (50px) is used in candidate generation: each candidate is placed
        // SPACING away from the *specific* placed box it was generated against.
        // The R-tree collision check only prevents overlap, not SPACING-distance.
        // Thus SPACING is guaranteed between directly-adjacent pairs, but components
        // placed adjacent to box B can be < SPACING from box A in multi-component layouts.

        it('two components are separated by >= SPACING', () => {
            // With exactly 2 components, the second is placed adjacent to the first
            // using candidate positions offset by SPACING — so the gap is exact.
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(0, 0, 100, 100),
                makeComponent(500, 500, 100, 100),
            ]

            const result: PackResult = packComponents(comps)
            const box0: BBox = shiftedBBox(comps[0], result.shifts[0])
            const box1: BBox = shiftedBBox(comps[1], result.shifts[1])

            const gap: number = minAxisGap(box0, box1)
            expect(gap).toBeGreaterThanOrEqual(SPACING - 1) // 1px float tolerance
        })

        it('no pairwise overlaps with many components (hard guarantee from R-tree)', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(0, 0, 100, 100),
                makeComponent(200, 0, 100, 100),
                makeComponent(0, 200, 80, 80),
                makeComponent(200, 200, 120, 60),
            ]

            const result: PackResult = packComponents(comps)
            const boxes: readonly BBox[] = comps.map((c: ComponentSubgraph, i: number): BBox =>
                shiftedBBox(c, result.shifts[i]),
            )

            const allPairs: readonly (readonly [number, number])[] = pairwiseIndices(boxes.length)
            allPairs.forEach(([i, j]: readonly [number, number]) => {
                expect(aabbOverlap(boxes[i], boxes[j])).toBe(false)
            })
        })

        it('all pairwise gaps are positive with many components', () => {
            const comps: readonly ComponentSubgraph[] = Array.from(
                { length: 8 },
                (_: unknown, i: number): ComponentSubgraph =>
                    makeComponent(i * 100, (i % 3) * 100, 50 + (i % 4) * 20, 40 + (i % 3) * 15),
            )

            const result: PackResult = packComponents(comps)
            const boxes: readonly BBox[] = comps.map((c: ComponentSubgraph, i: number): BBox =>
                shiftedBBox(c, result.shifts[i]),
            )

            const allPairs: readonly (readonly [number, number])[] = pairwiseIndices(boxes.length)
            allPairs.forEach(([i, j]: readonly [number, number]) => {
                const gap: number = minAxisGap(boxes[i], boxes[j])
                expect(gap).toBeGreaterThanOrEqual(0)
            })
        })
    })

    describe('aspect ratio', () => {
        it('result aspect ratio is between 0.3 and 3.0 for reasonably-sized inputs', () => {
            const comps: readonly ComponentSubgraph[] = Array.from(
                { length: 6 },
                (_: unknown, i: number): ComponentSubgraph =>
                    makeComponent(i * 300, i * 300, 100, 100),
            )

            const result: PackResult = packComponents(comps)
            const boxes: readonly BBox[] = comps.map((c: ComponentSubgraph, i: number): BBox =>
                shiftedBBox(c, result.shifts[i]),
            )

            const globalMinX: number = Math.min(...boxes.map((b: BBox): number => b.minX))
            const globalMinY: number = Math.min(...boxes.map((b: BBox): number => b.minY))
            const globalMaxX: number = Math.max(...boxes.map((b: BBox): number => b.maxX))
            const globalMaxY: number = Math.max(...boxes.map((b: BBox): number => b.maxY))

            const w: number = globalMaxX - globalMinX
            const h: number = globalMaxY - globalMinY
            const aspectRatio: number = w > h ? w / h : h / w

            expect(aspectRatio).toBeGreaterThanOrEqual(0.3)
            expect(aspectRatio).toBeLessThanOrEqual(3.0)
        })

        it('stays reasonable for mixed component sizes', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(0, 0, 200, 200),     // large
                makeComponent(500, 0, 50, 50),      // small
                makeComponent(0, 500, 50, 50),      // small
                makeComponent(500, 500, 100, 100),   // medium
                makeComponent(1000, 0, 30, 30),      // tiny
            ]

            const result: PackResult = packComponents(comps)
            const boxes: readonly BBox[] = comps.map((c: ComponentSubgraph, i: number): BBox =>
                shiftedBBox(c, result.shifts[i]),
            )

            const globalMinX: number = Math.min(...boxes.map((b: BBox): number => b.minX))
            const globalMinY: number = Math.min(...boxes.map((b: BBox): number => b.minY))
            const globalMaxX: number = Math.max(...boxes.map((b: BBox): number => b.maxX))
            const globalMaxY: number = Math.max(...boxes.map((b: BBox): number => b.maxY))

            const w: number = globalMaxX - globalMinX
            const h: number = globalMaxY - globalMinY
            const aspectRatio: number = w > h ? w / Math.max(h, 1) : h / Math.max(w, 1)

            expect(aspectRatio).toBeGreaterThanOrEqual(0.3)
            expect(aspectRatio).toBeLessThanOrEqual(3.0)
        })
    })

    describe('shift correctness', () => {
        it('shifts are in the same order as input components', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(0, 0, 50, 50),
                makeComponent(1000, 1000, 200, 200),
                makeComponent(500, 500, 100, 100),
            ]

            const result: PackResult = packComponents(comps)
            expect(result.shifts).toHaveLength(3)

            // The largest component (index 1: 200x200) is placed first at origin,
            // so its shifted bbox top-left should be at (0,0)
            const box1: BBox = shiftedBBox(comps[1], result.shifts[1])
            expect(box1.minX).toBeCloseTo(0, 0)
            expect(box1.minY).toBeCloseTo(0, 0)
        })
    })
})
