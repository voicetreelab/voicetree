/**
 * Black-box test for the boundary-width subgraph measure.
 *
 * Uses on-disk tempdir fixtures (real .ts files) because the measure
 * reads file contents via fs. Synthetic in-memory ParsedSubgraphs would
 * skip the AST signal.
 */
import {afterAll, describe, expect, it} from 'vitest'
import {parseSubgraph} from '../../../_shared/graph/parse-subgraph.ts'
import {
    boundaryWidthMeasure,
    BOUNDARY_WIDTH_THRESHOLD,
} from './boundary-width.ts'
import {buildTempRepo, type Fixture} from './test-support/tempdir-fixture.ts'

const cleanups: Fixture[] = []
afterAll(async () => {
    await Promise.all(cleanups.map(f => f.cleanup()))
})

describe('boundary-width (subgraph measure)', () => {
    it('GOOD: one-export-per-file community has narrow boundary', async () => {
        const fixture = await buildTempRepo([
            {pkg: 'pkg-x', relToSrc: 'core/a.ts', contents: 'export function a(): number { return 1 }\n'},
            {pkg: 'pkg-x', relToSrc: 'core/b.ts', contents: 'export function b(): number { return 2 }\n'},
            {pkg: 'pkg-x', relToSrc: 'core/c.ts', contents: 'export function c(): number { return 3 }\n'},
        ])
        cleanups.push(fixture)

        const sub = await parseSubgraph(fixture.absolutePaths, {repoRoot: fixture.repoRoot, depth: 1})
        const result = await boundaryWidthMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})

        expect(result.perCommunity['pkg-x/core']).toBe(3)
        expect(result.violations).toEqual([])
    })

    it('BAD: kitchen-sink module with many exports trips the budget', async () => {
        const declarations = Array.from({length: BOUNDARY_WIDTH_THRESHOLD + 5}, (_, i) =>
            `export function fn${i}(): number { return ${i} }`,
        ).join('\n') + '\n'
        const fixture = await buildTempRepo([
            {pkg: 'pkg-y', relToSrc: 'utils/grab-bag.ts', contents: declarations},
        ])
        cleanups.push(fixture)

        const sub = await parseSubgraph(fixture.absolutePaths, {repoRoot: fixture.repoRoot, depth: 1})
        const result = await boundaryWidthMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})

        expect(result.perCommunity['pkg-y/utils']).toBe(BOUNDARY_WIDTH_THRESHOLD + 5)
        const fails = result.violations.filter(v => v.severity === 'fail')
        expect(fails.length).toBe(1)
        expect(fails[0].message).toContain('wide public channel')
    })

    it('counts default + named + reexport flavours correctly', async () => {
        const fixture = await buildTempRepo([
            {
                pkg: 'pkg-z',
                relToSrc: 'mixed/index.ts',
                contents: [
                    'export const a = 1',
                    'export function b(): number { return 2 }',
                    'export class C {}',
                    'export type D = string',
                    'export interface E { x: number }',
                    'export default 42',
                ].join('\n') + '\n',
            },
        ])
        cleanups.push(fixture)
        const sub = await parseSubgraph(fixture.absolutePaths, {repoRoot: fixture.repoRoot, depth: 1})
        const result = await boundaryWidthMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})
        // a, b, C, D, E, default = 6.
        expect(result.perCommunity['pkg-z/mixed']).toBe(6)
    })
})
