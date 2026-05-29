/**
 * Black-box test for the structural-orange subgraph measure.
 *
 * Verifies:
 *   - GOOD shape (X→[shell]→{A,B,C,D}): X has score=1 (outEdges=1, fanOut=1).
 *   - BAD shape (X→A, X→B, X→C, X→D): X has score=16 (outEdges=4, fanOut=4).
 *   - Communities with outEdges=0 still appear in perCommunity with score=0
 *     (so the gate can detect "regressed from 0 to non-zero").
 *   - Absolute over-budget triggers a fail.
 *
 * We do not mock {@link computePriorityScoresAtDepth}; the measure is a
 * thin adapter and the unit-level behaviour we care about IS the formula.
 */
import {describe, expect, it} from 'vitest'
import {structuralOrangeMeasure, STRUCTURAL_ORANGE_THRESHOLD} from './structural-orange.ts'
import {makeSyntheticSubgraph, type FixtureFile} from './test-support/test-fixtures.ts'

const pkg = 'pkg-x'
const X = (name: string): FixtureFile => ({pkg, relToSrc: `x/${name}.ts`})
const A = (name: string): FixtureFile => ({pkg, relToSrc: `a/${name}.ts`})
const B = (name: string): FixtureFile => ({pkg, relToSrc: `b/${name}.ts`})
const C = (name: string): FixtureFile => ({pkg, relToSrc: `c/${name}.ts`})
const D = (name: string): FixtureFile => ({pkg, relToSrc: `d/${name}.ts`})
const Shell = (name: string): FixtureFile => ({pkg, relToSrc: `shell/${name}.ts`})

describe('structural-orange (subgraph measure)', () => {
    it('GOOD: X→[shell]→{A,B,C,D} keeps X at score=1', async () => {
        const subgraph = makeSyntheticSubgraph({
            files: [
                X('caller'),
                Shell('hub'),
                A('a'), B('b'), C('c'), D('d'),
            ],
            edges: [
                {from: X('caller'), to: Shell('hub')},
                {from: Shell('hub'), to: A('a')},
                {from: Shell('hub'), to: B('b')},
                {from: Shell('hub'), to: C('c')},
                {from: Shell('hub'), to: D('d')},
            ],
        })

        const result = await structuralOrangeMeasure.run({changedFiles: [], parsedSubgraph: subgraph})

        // X's community contributes 1 outedge to shell.
        expect(result.perCommunity[`${pkg}/x`]).toBe(1)
        // shell has 4 outEdges × fanOut 4 = 16 — that's the cost of the hub.
        expect(result.perCommunity[`${pkg}/shell`]).toBe(16)
        // leaves are pure sinks: 0.
        expect(result.perCommunity[`${pkg}/a`]).toBe(0)
        expect(result.perCommunity[`${pkg}/d`]).toBe(0)
        // 16 is well under the 340 threshold → no violations.
        expect(result.violations).toEqual([])
    })

    it('BAD: X→{A,B,C,D} blasts X to score=16', async () => {
        const subgraph = makeSyntheticSubgraph({
            files: [
                X('caller'),
                A('a'), B('b'), C('c'), D('d'),
            ],
            edges: [
                {from: X('caller'), to: A('a')},
                {from: X('caller'), to: B('b')},
                {from: X('caller'), to: C('c')},
                {from: X('caller'), to: D('d')},
            ],
        })

        const result = await structuralOrangeMeasure.run({changedFiles: [], parsedSubgraph: subgraph})

        // Direct: 4 outedges, 4 distinct targets.
        expect(result.perCommunity[`${pkg}/x`]).toBe(16)
    })

    it('emits perCommunity=0 for stable cores so baseline-diff sees regressions', async () => {
        const subgraph = makeSyntheticSubgraph({
            files: [A('one'), B('two')],
            edges: [{from: A('one'), to: B('two')}],
        })

        const result = await structuralOrangeMeasure.run({changedFiles: [], parsedSubgraph: subgraph})

        // A is the only outbound source → present with score>0.
        // B has outEdges=0 → MUST still appear in perCommunity at 0.
        expect(result.perCommunity[`${pkg}/a`]).toBeGreaterThan(0)
        expect(result.perCommunity[`${pkg}/b`]).toBe(0)
    })

    it('fails when a community exceeds the threshold', async () => {
        // Build a deliberately huge cross-community blast: 1 source, N targets,
        // each with K back-edges. Pick N, K so that outEdges * fanOut > 258.
        const sources: FixtureFile[] = Array.from({length: 30}, (_, i) =>
            ({pkg, relToSrc: `hub/file${i}.ts`}),
        )
        const targets: FixtureFile[] = Array.from({length: 10}, (_, i) =>
            ({pkg, relToSrc: `leaf-${i}/file.ts`}),
        )
        const edges = sources.flatMap(src => targets.map(tgt => ({from: src, to: tgt})))

        const subgraph = makeSyntheticSubgraph({
            files: [...sources, ...targets],
            edges,
        })

        const result = await structuralOrangeMeasure.run({changedFiles: [], parsedSubgraph: subgraph})
        const hubScore = result.perCommunity[`${pkg}/hub`]
        // 30 src × 10 tgt = 300 outEdges, fanOut = 10 → 3000.
        expect(hubScore).toBe(3000)
        expect(hubScore).toBeGreaterThan(STRUCTURAL_ORANGE_THRESHOLD)

        const hubFails = result.violations.filter(v =>
            v.community === `${pkg}/hub` && v.severity === 'fail',
        )
        expect(hubFails.length).toBe(1)
        expect(hubFails[0].message).toContain('threshold')
    })
})
