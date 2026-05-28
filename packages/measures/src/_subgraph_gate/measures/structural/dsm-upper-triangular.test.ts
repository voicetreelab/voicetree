/**
 * Black-box test for the dsm-upper-triangular subgraph measure.
 *
 * Verifies:
 *   - Pure helpers: orderCommunitiesTopologically + dsmForSiblingGroup
 *     produce correct DSMs for known DAGs and known cycles.
 *   - GOOD: A→B→C tiered architecture has zero below-diagonal cells.
 *   - BAD: cycle A→B, B→C, C→A produces below-diagonal cell(s).
 */
import {describe, expect, it} from 'vitest'
import {
    dsmForSiblingGroup,
    dsmUpperTriangularMeasure,
    DSM_BACKEDGE_THRESHOLD,
    orderCommunitiesTopologically,
} from './dsm-upper-triangular.ts'
import {makeSyntheticSubgraph, type FixtureFile} from './test-support/test-fixtures.ts'

describe('orderCommunitiesTopologically (pure)', () => {
    it('orders a simple DAG', () => {
        const adj = new Map([
            ['a', new Set(['b'])],
            ['b', new Set(['c'])],
            ['c', new Set<string>()],
        ])
        expect(orderCommunitiesTopologically(['a', 'b', 'c'], adj)).toEqual(['a', 'b', 'c'])
    })

    it('places SCCs together via condensation', () => {
        // a→b→c→a is an SCC of 3; d points to the SCC.
        const adj = new Map([
            ['a', new Set(['b'])],
            ['b', new Set(['c'])],
            ['c', new Set(['a'])],
            ['d', new Set(['a'])],
        ])
        const order = orderCommunitiesTopologically(['a', 'b', 'c', 'd'], adj)
        // d must come before any SCC member.
        expect(order.indexOf('d')).toBeLessThan(order.indexOf('a'))
        expect(order.indexOf('d')).toBeLessThan(order.indexOf('b'))
        expect(order.indexOf('d')).toBeLessThan(order.indexOf('c'))
    })
})

describe('dsmForSiblingGroup (pure)', () => {
    it('clean DAG → 0 below-diagonal cells', () => {
        const edgesBetween = new Map([
            ['a', new Map([['b', 2]])],
            ['b', new Map([['c', 1]])],
            ['c', new Map<string, number>()],
        ])
        const report = dsmForSiblingGroup(['a', 'b', 'c'], edgesBetween)
        expect(report.belowDiagonalCells).toBe(0)
        expect(report.nonZeroCells).toBe(2)
        // 3x3 matrix has 6 off-diagonal cells → 2/6 = 1/3.
        expect(report.compressionRatio).toBeCloseTo(2 / 6, 6)
    })

    it('cycle → at least one below-diagonal cell', () => {
        const edgesBetween = new Map([
            ['a', new Map([['b', 1]])],
            ['b', new Map([['c', 1]])],
            ['c', new Map([['a', 1]])],
        ])
        const report = dsmForSiblingGroup(['a', 'b', 'c'], edgesBetween)
        expect(report.belowDiagonalCells).toBeGreaterThanOrEqual(1)
    })
})

const pkg = 'pkg-dsm'

describe('dsm-upper-triangular (subgraph measure)', () => {
    it('GOOD: A→B→C tiered architecture has no back-edges', async () => {
        const A: FixtureFile = {pkg, relToSrc: 'a/a.ts'}
        const B: FixtureFile = {pkg, relToSrc: 'b/b.ts'}
        const C: FixtureFile = {pkg, relToSrc: 'c/c.ts'}
        const sub = makeSyntheticSubgraph({
            files: [A, B, C],
            edges: [
                {from: A, to: B},
                {from: B, to: C},
            ],
        })
        const result = await dsmUpperTriangularMeasure.run({changedFiles: [], parsedSubgraph: sub})
        expect(result.perCommunity[`${pkg}/a`]).toBe(0)
        expect(result.perCommunity[`${pkg}/b`]).toBe(0)
        expect(result.perCommunity[`${pkg}/c`]).toBe(0)
        expect(result.violations).toEqual([])
    })

    it('BAD: cycle produces below-diagonal cell, fails the gate', async () => {
        const A: FixtureFile = {pkg, relToSrc: 'a/a.ts'}
        const B: FixtureFile = {pkg, relToSrc: 'b/b.ts'}
        const C: FixtureFile = {pkg, relToSrc: 'c/c.ts'}
        const sub = makeSyntheticSubgraph({
            files: [A, B, C],
            edges: [
                {from: A, to: B},
                {from: B, to: C},
                {from: C, to: A},
            ],
        })
        const result = await dsmUpperTriangularMeasure.run({changedFiles: [], parsedSubgraph: sub})
        const totalBackEdges = result.perCommunity[`${pkg}/a`]
            + result.perCommunity[`${pkg}/b`]
            + result.perCommunity[`${pkg}/c`]
        expect(totalBackEdges).toBeGreaterThan(DSM_BACKEDGE_THRESHOLD)
        const fails = result.violations.filter(v => v.severity === 'fail')
        expect(fails.length).toBeGreaterThanOrEqual(1)
        expect(fails[0].message).toContain('cycle in tier order')
    })

    it('single-community parent → 0 (no DSM to evaluate)', async () => {
        const X1: FixtureFile = {pkg, relToSrc: 'solo/x.ts'}
        const X2: FixtureFile = {pkg, relToSrc: 'solo/y.ts'}
        const sub = makeSyntheticSubgraph({
            files: [X1, X2],
            edges: [{from: X1, to: X2}],
        })
        const result = await dsmUpperTriangularMeasure.run({changedFiles: [], parsedSubgraph: sub})
        expect(result.perCommunity[`${pkg}/solo`]).toBe(0)
        expect(result.violations).toEqual([])
    })
})
