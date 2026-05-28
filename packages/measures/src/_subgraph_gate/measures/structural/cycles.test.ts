/**
 * Black-box test for the cycles subgraph measure.
 *
 * Verifies:
 *   - Pure helper: findNonTrivialSccs returns expected components for DAGs
 *     and for known cycles.
 *   - GOOD: acyclic subgraph → score 0 for every community.
 *   - BAD intra-community cycle: 2 files in same community import each other.
 *   - BAD cross-community cycle: A→B + B→A across two same-pkg communities.
 *   - BAD cross-package cycle: cycle spans two packages.
 */
import {describe, expect, it} from 'vitest'
import {
    cyclesMeasure,
    CYCLES_BUDGET,
    findNonTrivialSccs,
} from './cycles.ts'
import {makeSyntheticSubgraph, type FixtureFile} from './test-support/test-fixtures.ts'

describe('findNonTrivialSccs (pure)', () => {
    it('DAG → no non-trivial SCCs', () => {
        const adj = new Map([
            ['a', new Set(['b'])],
            ['b', new Set(['c'])],
            ['c', new Set<string>()],
        ])
        expect(findNonTrivialSccs(['a', 'b', 'c'], adj)).toEqual([])
    })

    it('triangle cycle → single SCC of 3', () => {
        const adj = new Map([
            ['a', new Set(['b'])],
            ['b', new Set(['c'])],
            ['c', new Set(['a'])],
        ])
        const sccs = findNonTrivialSccs(['a', 'b', 'c'], adj)
        expect(sccs.length).toBe(1)
        expect(sccs[0].sort()).toEqual(['a', 'b', 'c'])
    })

    it('counts a self-loop as non-trivial', () => {
        const adj = new Map([['a', new Set(['a'])]])
        const sccs = findNonTrivialSccs(['a'], adj)
        expect(sccs).toEqual([['a']])
    })

    it('two disjoint cycles → two SCCs', () => {
        const adj = new Map([
            ['a', new Set(['b'])], ['b', new Set(['a'])],
            ['c', new Set(['d'])], ['d', new Set(['c'])],
        ])
        expect(findNonTrivialSccs(['a', 'b', 'c', 'd'], adj).length).toBe(2)
    })
})

const pkg = 'pkg-cyc'
const otherPkg = 'pkg-other'

describe('cycles (subgraph measure)', () => {
    it('GOOD: acyclic subgraph → 0 cycles per community', async () => {
        const A: FixtureFile = {pkg, relToSrc: 'a/a.ts'}
        const B: FixtureFile = {pkg, relToSrc: 'b/b.ts'}
        const sub = makeSyntheticSubgraph({
            files: [A, B],
            edges: [{from: A, to: B}],
        })
        const result = await cyclesMeasure.run({changedFiles: [], parsedSubgraph: sub})
        expect(result.perCommunity[`${pkg}/a`]).toBe(0)
        expect(result.perCommunity[`${pkg}/b`]).toBe(0)
        expect(result.violations).toEqual([])
    })

    it('BAD intra-community cycle: two files in one community import each other', async () => {
        const A1: FixtureFile = {pkg, relToSrc: 'state/store.ts'}
        const A2: FixtureFile = {pkg, relToSrc: 'state/reducer.ts'}
        const sub = makeSyntheticSubgraph({
            files: [A1, A2],
            edges: [{from: A1, to: A2}, {from: A2, to: A1}],
        })
        const result = await cyclesMeasure.run({changedFiles: [], parsedSubgraph: sub})
        expect(result.perCommunity[`${pkg}/state`]).toBe(1)
        const fails = result.violations.filter(v => v.severity === 'fail')
        expect(fails.length).toBe(1)
        expect(fails[0].message).toContain('intra-community')
    })

    it('BAD cross-community cycle within one package', async () => {
        const A: FixtureFile = {pkg, relToSrc: 'state/store.ts'}
        const B: FixtureFile = {pkg, relToSrc: 'workflows/load.ts'}
        const sub = makeSyntheticSubgraph({
            files: [A, B],
            edges: [{from: A, to: B}, {from: B, to: A}],
        })
        const result = await cyclesMeasure.run({changedFiles: [], parsedSubgraph: sub})
        expect(result.perCommunity[`${pkg}/state`]).toBe(1)
        expect(result.perCommunity[`${pkg}/workflows`]).toBe(1)
        const fail = result.violations.find(v => v.community === `${pkg}/state`)!
        expect(fail.message).toContain('cross-community')
    })

    it('BAD cross-package cycle: SCC spans 2 packages', async () => {
        const A: FixtureFile = {pkg, relToSrc: 'state/store.ts'}
        const B: FixtureFile = {pkg: otherPkg, relToSrc: 'client/api.ts'}
        const sub = makeSyntheticSubgraph({
            files: [A, B],
            edges: [{from: A, to: B}, {from: B, to: A}],
        })
        const result = await cyclesMeasure.run({changedFiles: [], parsedSubgraph: sub})
        // Both communities are touched, both report the SCC.
        expect(result.perCommunity[`${pkg}/state`]).toBe(1)
        expect(result.perCommunity[`${otherPkg}/client`]).toBe(1)
        const fail = result.violations.find(v => v.community === `${pkg}/state`)!
        expect(fail.message).toContain('cross-package')
        // Must exceed budget either way.
        expect(result.perCommunity[`${pkg}/state`]).toBeGreaterThan(CYCLES_BUDGET)
    })
})
