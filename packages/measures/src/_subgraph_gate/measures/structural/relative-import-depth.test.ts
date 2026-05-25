/**
 * Black-box test for the relative-import-depth subgraph measure.
 *
 * Uses on-disk tempdir fixtures with the `packages/libraries` layer
 * prefix — the measure scopes by relativePath (matching the full-graph
 * scope: webapp/src + packages/systems/<X>/src + packages/libraries/<X>/src
 * + voicetree-mcp/bin). Without that prefix, the fixture files fall
 * outside scope and the measure reports zero.
 */
import {afterAll, describe, expect, it} from 'vitest'
import {parseSubgraph} from '../../../_shared/graph/parse-subgraph.ts'
import {
    relativeImportDepthMeasure,
} from './relative-import-depth.ts'
import {buildTempRepo, type Fixture} from './_tempdir-fixture.ts'

const LAYER = 'packages/libraries'

const cleanups: Fixture[] = []
afterAll(async () => {
    await Promise.all(cleanups.map(f => f.cleanup()))
})

describe('relative-import-depth (subgraph measure)', () => {
    it('GOOD: shallow same-package relative imports produce no violations', async () => {
        const fixture = await buildTempRepo([
            {pkg: 'pkg-x', relToSrc: 'core/a.ts', contents: "import './b.ts'\nexport const a = 1\n"},
            {pkg: 'pkg-x', relToSrc: 'core/b.ts', contents: "import '../utils/z.ts'\nexport const b = 2\n"},
            {pkg: 'pkg-x', relToSrc: 'utils/z.ts', contents: 'export const z = 3\n'},
        ], {layerPrefix: LAYER})
        cleanups.push(fixture)

        const sub = await parseSubgraph(fixture.absolutePaths, {repoRoot: fixture.repoRoot, depth: 1})
        const result = await relativeImportDepthMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})

        expect(result.perCommunity['pkg-x/core']).toBe(0)
        expect(result.perCommunity['pkg-x/utils']).toBe(0)
        expect(result.violations).toEqual([])
    })

    it('BAD: cross-package relative import (any depth) fails the gate', async () => {
        const fixture = await buildTempRepo([
            {pkg: 'pkg-a', relToSrc: 'x.ts', contents: "import '../../pkg-b/src/y.ts'\nexport const x = 1\n"},
            {pkg: 'pkg-b', relToSrc: 'y.ts', contents: 'export const y = 2\n'},
        ], {layerPrefix: LAYER})
        cleanups.push(fixture)

        const sub = await parseSubgraph(fixture.absolutePaths, {repoRoot: fixture.repoRoot, depth: 1})
        const result = await relativeImportDepthMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})

        expect(result.perCommunity['pkg-a/__root__']).toBe(1)
        expect(result.perCommunity['pkg-b/__root__']).toBe(0)
        const fails = result.violations.filter(v => v.severity === 'fail')
        expect(fails.length).toBe(1)
        expect(fails[0].community).toBe('pkg-a/__root__')
        expect(fails[0].message).toContain('relative-cross-package')
    })

    it('BAD: deep same-package relative import (../../) fails the gate', async () => {
        const fixture = await buildTempRepo([
            {pkg: 'pkg-q', relToSrc: 'a/b/c.ts', contents: "import '../../helpers/z.ts'\nexport const c = 1\n"},
            {pkg: 'pkg-q', relToSrc: 'helpers/z.ts', contents: 'export const z = 2\n'},
        ], {layerPrefix: LAYER})
        cleanups.push(fixture)

        const sub = await parseSubgraph(fixture.absolutePaths, {repoRoot: fixture.repoRoot, depth: 1})
        const result = await relativeImportDepthMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})

        expect(result.perCommunity['pkg-q/a']).toBe(1)
        const fails = result.violations.filter(v => v.severity === 'fail')
        expect(fails.length).toBe(1)
        expect(fails[0].community).toBe('pkg-q/a')
        expect(fails[0].message).toContain('relative-same-package-deep')
    })

    it('counts re-exports and dynamic-imports as imports', async () => {
        const fixture = await buildTempRepo([
            {
                pkg: 'pkg-m',
                relToSrc: 'feature/index.ts',
                contents: [
                    "export {y} from '../../pkg-n/src/y.ts'",
                    "const _ = import('../../pkg-n/src/y.ts')",
                    'export const here = 1',
                ].join('\n') + '\n',
            },
            {pkg: 'pkg-n', relToSrc: 'y.ts', contents: 'export const y = 1\n'},
        ], {layerPrefix: LAYER})
        cleanups.push(fixture)

        const sub = await parseSubgraph(fixture.absolutePaths, {repoRoot: fixture.repoRoot, depth: 1})
        const result = await relativeImportDepthMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})

        expect(result.perCommunity['pkg-m/feature']).toBe(2)
    })

    it('files outside the full-graph scope (e.g. measures package) are ignored', async () => {
        const fixture = await buildTempRepo([
            {pkg: 'measures', relToSrc: 'x/y/z.ts', contents: "import '../../other.ts'\nexport const z = 1\n"},
            {pkg: 'measures', relToSrc: 'other.ts', contents: 'export const o = 2\n'},
        ], {layerPrefix: 'packages'}) // not under `packages/libraries` or `packages/systems`
        cleanups.push(fixture)

        const sub = await parseSubgraph(fixture.absolutePaths, {repoRoot: fixture.repoRoot, depth: 1})
        const result = await relativeImportDepthMeasure.run({changedFiles: fixture.absolutePaths, parsedSubgraph: sub})

        expect(result.perCommunity['measures/x']).toBe(0)
        expect(result.violations).toEqual([])
    })
})
