/**
 * Black-box test for the tree-width-approx subgraph measure.
 *
 * Hand-checks of the min-degree elimination bound:
 *   - Pipeline A→B→C→D→E:    tw = 1 (every elimination has degree 1).
 *   - K4 mesh (4 vertices, 6 edges): tw = 3 (every vertex has degree 3
 *     when picked, no fill-in needed; bag = 3).
 *   - K5 mesh: tw = 4.
 *   - Empty / single-file community: tw = 0.
 *
 * We test the pure helper directly (it's exported precisely for this),
 * AND the SubgraphMeasure.run() wrapper.
 */
import {describe, expect, it} from 'vitest'
import {
    treeWidthApproxMeasure,
    treeWidthUpperBound,
    TREE_WIDTH_THRESHOLD,
} from './tree-width-approx.ts'
import {makeSyntheticSubgraph, type FixtureFile} from './test-support/test-fixtures.ts'

describe('treeWidthUpperBound (pure)', () => {
    it('returns 0 for ≤1 vertex', () => {
        expect(treeWidthUpperBound(new Set(), new Map())).toBe(0)
        expect(treeWidthUpperBound(new Set(['a']), new Map([['a', new Set()]]))).toBe(0)
    })

    it('returns 1 for a path graph (pipeline)', () => {
        const vertices = new Set(['a', 'b', 'c', 'd', 'e'])
        const adjacency = new Map([
            ['a', new Set(['b'])],
            ['b', new Set(['a', 'c'])],
            ['c', new Set(['b', 'd'])],
            ['d', new Set(['c', 'e'])],
            ['e', new Set(['d'])],
        ])
        expect(treeWidthUpperBound(vertices, adjacency)).toBe(1)
    })

    it('returns N-1 for a complete graph K_N', () => {
        // K4 — 4 vertices fully connected.
        const k4Vertices = new Set(['a', 'b', 'c', 'd'])
        const k4Adj = new Map([
            ['a', new Set(['b', 'c', 'd'])],
            ['b', new Set(['a', 'c', 'd'])],
            ['c', new Set(['a', 'b', 'd'])],
            ['d', new Set(['a', 'b', 'c'])],
        ])
        expect(treeWidthUpperBound(k4Vertices, k4Adj)).toBe(3)

        // K5 — 5 vertices fully connected.
        const k5Vertices = new Set(['a', 'b', 'c', 'd', 'e'])
        const k5Adj = new Map<string, Set<string>>()
        for (const v of k5Vertices) {
            k5Adj.set(v, new Set([...k5Vertices].filter(o => o !== v)))
        }
        expect(treeWidthUpperBound(k5Vertices, k5Adj)).toBe(4)
    })

    it('handles the mesh example from the spec: 3x2 with X-crosses', () => {
        //     A─B─C
        //     │×│×│
        //     D─E─F
        // After triangulation by min-degree elimination the resulting
        // bag-width upper bound is in 3..5; pin it as ≥3 to demonstrate
        // "tangled" semantics.
        const v = new Set(['A', 'B', 'C', 'D', 'E', 'F'])
        const adj = new Map<string, Set<string>>([
            ['A', new Set(['B', 'D', 'E'])],
            ['B', new Set(['A', 'C', 'D', 'E', 'F'])],
            ['C', new Set(['B', 'E', 'F'])],
            ['D', new Set(['A', 'B', 'E'])],
            ['E', new Set(['A', 'B', 'C', 'D', 'F'])],
            ['F', new Set(['B', 'C', 'E'])],
        ])
        expect(treeWidthUpperBound(v, adj)).toBeGreaterThanOrEqual(3)
    })
})

const pkg = 'pkg-x'
const inC = (sub: string, name: string): FixtureFile => ({pkg, relToSrc: `${sub}/${name}.ts`})

describe('tree-width-approx (subgraph measure)', () => {
    it('GOOD: in-community pipeline scores tw=1', async () => {
        const sub = makeSyntheticSubgraph({
            files: [
                inC('core', 'a'), inC('core', 'b'), inC('core', 'c'), inC('core', 'd'), inC('core', 'e'),
                inC('other', 'caller'),
            ],
            edges: [
                {from: inC('core', 'a'), to: inC('core', 'b')},
                {from: inC('core', 'b'), to: inC('core', 'c')},
                {from: inC('core', 'c'), to: inC('core', 'd')},
                {from: inC('core', 'd'), to: inC('core', 'e')},
                // External call doesn't enter the in-community subgraph.
                {from: inC('other', 'caller'), to: inC('core', 'a')},
            ],
        })

        const result = await treeWidthApproxMeasure.run({changedFiles: [], parsedSubgraph: sub})
        expect(result.perCommunity[`${pkg}/core`]).toBe(1)
        expect(result.violations).toEqual([])
    })

    it('BAD: in-community K4 mesh scores tw=3', async () => {
        const files = [inC('mesh', 'a'), inC('mesh', 'b'), inC('mesh', 'c'), inC('mesh', 'd')]
        const edges = files.flatMap(f1 => files.filter(f2 => f1 !== f2).map(f2 => ({from: f1, to: f2})))
        const sub = makeSyntheticSubgraph({files, edges})

        const result = await treeWidthApproxMeasure.run({changedFiles: [], parsedSubgraph: sub})
        expect(result.perCommunity[`${pkg}/mesh`]).toBe(3)
    })

    it('fails when in-community treewidth exceeds the budget', async () => {
        // Build a fully-connected K7 inside one community — tw = 6 > 5.
        const files: FixtureFile[] = Array.from({length: 7}, (_, i) => inC('tangle', `f${i}`))
        const edges = files.flatMap(f1 => files.filter(f2 => f1 !== f2).map(f2 => ({from: f1, to: f2})))
        const sub = makeSyntheticSubgraph({files, edges})

        const result = await treeWidthApproxMeasure.run({changedFiles: [], parsedSubgraph: sub})
        expect(result.perCommunity[`${pkg}/tangle`]).toBeGreaterThan(TREE_WIDTH_THRESHOLD)
        expect(result.violations.length).toBe(1)
        expect(result.violations[0].severity).toBe('fail')
    })

    it('ignores cross-community edges in the score', async () => {
        // Touched community 'small' has 2 files with 1 edge — tw = 1.
        // Big mesh of OTHER community shouldn't pollute it.
        const sub = makeSyntheticSubgraph({
            files: [
                inC('small', 'a'), inC('small', 'b'),
                inC('other', 'x'), inC('other', 'y'), inC('other', 'z'),
            ],
            edges: [
                {from: inC('small', 'a'), to: inC('small', 'b')},
                // Cross-community edge — must not bump 'small'.
                {from: inC('small', 'a'), to: inC('other', 'x')},
                // Mesh inside 'other' — affects 'other', not 'small'.
                {from: inC('other', 'x'), to: inC('other', 'y')},
                {from: inC('other', 'y'), to: inC('other', 'z')},
                {from: inC('other', 'x'), to: inC('other', 'z')},
            ],
        })

        const result = await treeWidthApproxMeasure.run({changedFiles: [], parsedSubgraph: sub})
        expect(result.perCommunity[`${pkg}/small`]).toBe(1)
    })
})
