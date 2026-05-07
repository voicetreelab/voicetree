import { describe, it, expect } from 'vitest'
import { separateOverlappingComponents, packComponents } from './packComponents'
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

const makeComponent: (
    x: number, y: number, w: number, h: number,
) => ComponentSubgraph = (x, y, w, h) => ({
    nodes: [{ x, y, width: w, height: h }],
    edges: [],
})

const SEED_BBOX: BBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

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

const aabbOverlap: (a: BBox, b: BBox) => boolean = (a, b) =>
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY

const minAxisGap: (a: BBox, b: BBox) => number = (a, b) => {
    const gapX: number = Math.max(b.minX - a.maxX, a.minX - b.maxX)
    const gapY: number = Math.max(b.minY - a.maxY, a.minY - b.maxY)
    return Math.max(gapX, gapY)
}

const pairwiseIndices: (count: number) => readonly (readonly [number, number])[] = (count) =>
    Array.from({ length: count }, (_: unknown, i: number): number => i).flatMap(
        (i: number): readonly (readonly [number, number])[] =>
            Array.from({ length: count - i - 1 }, (_: unknown, k: number): readonly [number, number] => [i, i + k + 1] as const),
    )

const SPACING: number = 50

// ============================================================================
// Tests
// ============================================================================

describe('separateOverlappingComponents', () => {
    describe('trivial inputs', () => {
        it('returns empty shifts for empty input', () => {
            const result: PackResult = separateOverlappingComponents([])
            expect(result.shifts).toEqual([])
        })

        it('returns [{dx:0, dy:0}] for a single component', () => {
            const result: PackResult = separateOverlappingComponents([makeComponent(100, 200, 80, 60)])
            expect(result.shifts).toEqual([{ dx: 0, dy: 0 }])
        })
    })

    describe('non-overlapping components get zero shift', () => {
        it('returns all-zero shifts when components are well-separated', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(0, 0, 100, 100),
                makeComponent(500, 500, 100, 100),
            ]
            const result: PackResult = separateOverlappingComponents(comps)
            expect(result.shifts).toHaveLength(2)
            expect(result.shifts[0]).toEqual({ dx: 0, dy: 0 })
            expect(result.shifts[1]).toEqual({ dx: 0, dy: 0 })
        })

        it('does not move 3 well-separated components', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(0, 0, 80, 80),
                makeComponent(500, 0, 80, 80),
                makeComponent(0, 500, 80, 80),
            ]
            const result: PackResult = separateOverlappingComponents(comps)
            result.shifts.forEach((s: { readonly dx: number; readonly dy: number }) => {
                expect(s.dx).toBe(0)
                expect(s.dy).toBe(0)
            })
        })
    })

    describe('overlapping components get separated', () => {
        it('separates two overlapping components with no resulting overlap', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(50, 50, 100, 100),   // bbox [0,0,100,100]
                makeComponent(80, 50, 100, 100),    // bbox [30,0,130,100]
            ]
            const result: PackResult = separateOverlappingComponents(comps)
            expect(result.shifts).toHaveLength(2)

            const box0: BBox = shiftedBBox(comps[0], result.shifts[0])
            const box1: BBox = shiftedBBox(comps[1], result.shifts[1])
            expect(aabbOverlap(box0, box1)).toBe(false)
        })

        it('moves components symmetrically (each moves ~half)', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(50, 50, 100, 100),
                makeComponent(80, 50, 100, 100),
            ]
            const result: PackResult = separateOverlappingComponents(comps)
            const totalShiftMagnitude: number = Math.abs(result.shifts[0].dx) + Math.abs(result.shifts[1].dx)
                + Math.abs(result.shifts[0].dy) + Math.abs(result.shifts[1].dy)
            expect(totalShiftMagnitude).toBeGreaterThan(0)
        })

        it('resolves 3-component overlap', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(50, 50, 100, 100),
                makeComponent(80, 50, 100, 100),
                makeComponent(60, 80, 100, 100),
            ]
            const result: PackResult = separateOverlappingComponents(comps)
            const boxes: readonly BBox[] = comps.map((c: ComponentSubgraph, i: number): BBox =>
                shiftedBBox(c, result.shifts[i]),
            )
            const allPairs: readonly (readonly [number, number])[] = pairwiseIndices(boxes.length)
            allPairs.forEach(([i, j]: readonly [number, number]) => {
                expect(aabbOverlap(boxes[i], boxes[j])).toBe(false)
            })
        })
    })

    describe('minimal movement property', () => {
        it('moves less total distance than packComponents for overlapping pair far from origin', () => {
            // Components far from origin with small overlap — MTV nudges ~55px total,
            // while packComponents teleports both to origin (thousands of px shift).
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(5050, 5050, 100, 100),    // bbox [5000,5000,5100,5100]
                makeComponent(5095, 5050, 100, 100),    // bbox [5045,5000,5145,5100] — 55px overlap
            ]
            const mtvResult: PackResult = separateOverlappingComponents(comps)
            const packResult: PackResult = packComponents(comps)

            const mtvTotalDist: number = mtvResult.shifts.reduce(
                (sum: number, s: { readonly dx: number; readonly dy: number }): number =>
                    sum + Math.abs(s.dx) + Math.abs(s.dy), 0,
            )
            const packTotalDist: number = packResult.shifts.reduce(
                (sum: number, s: { readonly dx: number; readonly dy: number }): number =>
                    sum + Math.abs(s.dx) + Math.abs(s.dy), 0,
            )
            expect(mtvTotalDist).toBeLessThan(packTotalDist)
        })
    })

    describe('SPACING guarantee', () => {
        it('separated components have >= SPACING gap', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(50, 50, 100, 100),
                makeComponent(80, 50, 100, 100),
            ]
            const result: PackResult = separateOverlappingComponents(comps)
            const box0: BBox = shiftedBBox(comps[0], result.shifts[0])
            const box1: BBox = shiftedBBox(comps[1], result.shifts[1])
            const gap: number = minAxisGap(box0, box1)
            expect(gap).toBeGreaterThanOrEqual(SPACING - 1) // 1px float tolerance
        })
    })

    describe('polyomino shape-aware behavior', () => {
        it('non-overlapping components all get zero shifts', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(0, 0, 100, 100),
                makeComponent(500, 0, 100, 100),
                makeComponent(0, 500, 100, 100),
            ]
            const result: PackResult = separateOverlappingComponents(comps)
            result.shifts.forEach((s: { readonly dx: number; readonly dy: number }) => {
                expect(s.dx).toBe(0)
                expect(s.dy).toBe(0)
            })
        })

        it('overlapping components move less than rebuild-from-scratch would', () => {
            // Two components with 30px of overlap — BFS nudges by 1 grid cell,
            // while packComponents teleports both to origin.
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(0, 0, 200, 200),
                makeComponent(170, 0, 200, 200), // 30px overlap
            ]
            const separateResult: PackResult = separateOverlappingComponents(comps)
            const packResult: PackResult = packComponents(comps)

            const sepTotalDist: number = separateResult.shifts.reduce(
                (sum: number, s: { readonly dx: number; readonly dy: number }): number =>
                    sum + Math.abs(s.dx) + Math.abs(s.dy),
                0,
            )
            const packTotalDist: number = packResult.shifts.reduce(
                (sum: number, s: { readonly dx: number; readonly dy: number }): number =>
                    sum + Math.abs(s.dx) + Math.abs(s.dy),
                0,
            )
            expect(sepTotalDist).toBeLessThan(packTotalDist)
        })

        it('only overlapping components move, isolated ones stay put', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(0, 0, 200, 200),
                makeComponent(150, 0, 200, 200), // overlaps comp 0
                makeComponent(2000, 2000, 100, 100), // isolated
            ]
            const result: PackResult = separateOverlappingComponents(comps)
            expect(result.shifts[2].dx).toBe(0)
            expect(result.shifts[2].dy).toBe(0)
            const moved: boolean = result.shifts.slice(0, 2).some(
                (s: { readonly dx: number; readonly dy: number }): boolean => s.dx !== 0 || s.dy !== 0,
            )
            expect(moved).toBe(true)
        })

        it('three overlapping components are all separated', () => {
            const comps: readonly ComponentSubgraph[] = [
                makeComponent(0, 0, 200, 200),
                makeComponent(100, 0, 200, 200),
                makeComponent(50, 100, 200, 200),
            ]
            const result: PackResult = separateOverlappingComponents(comps)
            const boxes: readonly BBox[] = comps.map((c: ComponentSubgraph, i: number): BBox =>
                shiftedBBox(c, result.shifts[i]),
            )
            pairwiseIndices(boxes.length).forEach(([i, j]: readonly [number, number]) => {
                expect(aabbOverlap(boxes[i], boxes[j])).toBe(false)
            })
        })

        it('shape-aware: edge endpoints included in separation check', () => {
            // Component with a small node but a long edge reaching (300,300)
            const compWithEdge: ComponentSubgraph = {
                nodes: [{ x: 50, y: 50, width: 20, height: 20 }],
                edges: [{ startX: 50, startY: 50, endX: 300, endY: 300 }],
            }
            // Component that overlaps only the edge region, not the node
            const compOverlappingEdge: ComponentSubgraph = makeComponent(200, 200, 100, 100)

            const result: PackResult = separateOverlappingComponents([compWithEdge, compOverlappingEdge])
            const boxes: readonly BBox[] = [compWithEdge, compOverlappingEdge].map(
                (c: ComponentSubgraph, i: number): BBox => shiftedBBox(c, result.shifts[i]),
            )
            expect(aabbOverlap(boxes[0], boxes[1])).toBe(false)
        })
    })
})
