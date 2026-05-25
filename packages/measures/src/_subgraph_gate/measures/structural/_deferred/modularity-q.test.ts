/**
 * Black-box test for the modularity-q subgraph measure.
 *
 * Verifies:
 *   - GOOD: two tight clusters with one bridge → Q ≥ 0.3.
 *   - BAD: fully-meshed sibling communities → Q < 0.3.
 *   - Per-community attribution: every touched community gets its
 *     parent's Q.
 */
import {describe, expect, it} from 'vitest'
import {
    computePerParentQ,
    modularityQMeasure,
    MODULARITY_Q_FAIL,
} from './modularity-q.ts'
import {makeSyntheticSubgraph, type FixtureFile} from '../test-support/test-fixtures.ts'

const pkg = 'pkg-mod'

describe('modularity-q (subgraph measure)', () => {
    it('GOOD: two tight clusters, single bridge → Q ≥ threshold', async () => {
        const A1: FixtureFile = {pkg, relToSrc: 'a/a1.ts'}
        const A2: FixtureFile = {pkg, relToSrc: 'a/a2.ts'}
        const A3: FixtureFile = {pkg, relToSrc: 'a/a3.ts'}
        const B1: FixtureFile = {pkg, relToSrc: 'b/b1.ts'}
        const B2: FixtureFile = {pkg, relToSrc: 'b/b2.ts'}
        const B3: FixtureFile = {pkg, relToSrc: 'b/b3.ts'}

        const sub = makeSyntheticSubgraph({
            files: [A1, A2, A3, B1, B2, B3],
            edges: [
                // a-cluster: 3 internal edges
                {from: A1, to: A2}, {from: A2, to: A3}, {from: A3, to: A1},
                // b-cluster: 3 internal edges
                {from: B1, to: B2}, {from: B2, to: B3}, {from: B3, to: B1},
                // single cross-cluster bridge
                {from: A1, to: B1},
            ],
        })

        const result = await modularityQMeasure.run({changedFiles: [], parsedSubgraph: sub})
        const q = result.perCommunity[`${pkg}/a`]
        expect(q).toBeGreaterThanOrEqual(MODULARITY_Q_FAIL)
        // Both touched communities (a and b) share the same parent → same Q.
        expect(result.perCommunity[`${pkg}/a`]).toBeCloseTo(result.perCommunity[`${pkg}/b`], 6)
        expect(result.violations).toEqual([])
    })

    it('BAD: dense cross-cluster mesh → Q below threshold, fails', async () => {
        const A1: FixtureFile = {pkg, relToSrc: 'a/a1.ts'}
        const A2: FixtureFile = {pkg, relToSrc: 'a/a2.ts'}
        const B1: FixtureFile = {pkg, relToSrc: 'b/b1.ts'}
        const B2: FixtureFile = {pkg, relToSrc: 'b/b2.ts'}

        const sub = makeSyntheticSubgraph({
            files: [A1, A2, B1, B2],
            edges: [
                // Every file talks to every file in the other community,
                // plus none internally — partition has no signal.
                {from: A1, to: B1}, {from: A1, to: B2},
                {from: A2, to: B1}, {from: A2, to: B2},
                {from: B1, to: A1}, {from: B1, to: A2},
                {from: B2, to: A1}, {from: B2, to: A2},
            ],
        })

        const result = await modularityQMeasure.run({changedFiles: [], parsedSubgraph: sub})
        const q = result.perCommunity[`${pkg}/a`]
        expect(q).toBeLessThan(MODULARITY_Q_FAIL)

        const fails = result.violations.filter(v => v.severity === 'fail')
        // Both touched communities should fail under the same parent's bad Q.
        expect(fails.length).toBe(2)
        for (const f of fails) {
            expect(f.message).toContain('not a meaningful module boundary')
        }
    })

    it('single-community parent → Q sentinel 1.0 (no partition to evaluate)', async () => {
        const X1: FixtureFile = {pkg, relToSrc: 'only/x.ts'}
        const X2: FixtureFile = {pkg, relToSrc: 'only/y.ts'}
        const sub = makeSyntheticSubgraph({
            files: [X1, X2],
            edges: [{from: X1, to: X2}],
        })
        const result = await modularityQMeasure.run({changedFiles: [], parsedSubgraph: sub})
        expect(result.perCommunity[`${pkg}/only`]).toBe(1.0)
        expect(result.violations).toEqual([])
    })
})

describe('computePerParentQ (pure)', () => {
    it('emits one entry per parent that has ≥2 sibling communities', () => {
        const A: FixtureFile = {pkg, relToSrc: 'a/x.ts'}
        const B: FixtureFile = {pkg, relToSrc: 'b/y.ts'}
        const sub = makeSyntheticSubgraph({
            files: [A, B],
            edges: [{from: A, to: B}],
        })
        const perParent = computePerParentQ(sub.files, sub.edges, sub.depth)
        expect([...perParent.keys()]).toEqual([pkg]) // parent at depth 1 is the pkg
    })
})
