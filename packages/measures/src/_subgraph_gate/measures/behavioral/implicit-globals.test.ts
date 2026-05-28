/**
 * Black-box tests for the `implicit-globals` measure.
 *
 * As with module-state-bindings, the measure is exercised through its
 * public `SubgraphMeasure.run` contract against in-memory ts-morph
 * projects — no mocking of internals.
 */
import {Project} from 'ts-morph'
import {describe, expect, it} from 'vitest'
import {measure, analyzeFile, MEASURE_ID} from './implicit-globals.ts'
import type {ParsedSubgraph} from '../../../_shared/graph/parse-subgraph.ts'
import type {SourceFile as SubgraphSourceFile} from '../../../_shared/graph/import-graph.ts'

type FixtureFile = {
    readonly path: string
    readonly community: string
    readonly content: string
}

function buildSubgraph(files: readonly FixtureFile[], touched: readonly string[]): ParsedSubgraph {
    const project = new Project({useInMemoryFileSystem: true})
    for (const f of files) project.createSourceFile(f.path, f.content)
    const subgraphFiles: SubgraphSourceFile[] = files.map(f => ({
        absolutePath: f.path,
        relativePath: f.path.replace(/^\/virtual\//, ''),
        relToSrc: f.path.replace(/^\/virtual\/[^/]+\/src\//, ''),
        packageName: f.path.match(/^\/virtual\/([^/]+)\/src\//)?.[1] ?? 'unknown',
    }))
    const communityMap = new Map<string, string>(files.map(f => [f.path, f.community]))
    const contents = new Map(files.map(f => [f.path, f.content]))
    return {
        files: subgraphFiles,
        communityMap,
        edges: [],
        touchedCommunities: [...touched].sort(),
        depth: 1,
        getProject: () => project,
        getContent: (p) => contents.get(p) ?? null,
    }
}

// --- analyzeFile (pure) ---

describe('analyzeFile (implicit-globals)', () => {
    it('returns zero on a fully pure file', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts',
            `export const add = (x: number, y: number) => x + y\n`)
        const report = analyzeFile(sf)
        expect(report.total).toBe(0)
        expect(report.byCategory).toEqual({})
    })

    it('counts `fs` imports + downstream usages under `fs`', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            import {readFileSync, writeFileSync} from 'node:fs'
            export const dump = (path: string, data: string) => {
                writeFileSync(path, data)
                return readFileSync(path, 'utf8')
            }
        `)
        const report = analyzeFile(sf)
        // 1 import (the declaration) + 1 readFileSync usage + 1 writeFileSync usage = 3
        expect(report.byCategory.fs).toBeGreaterThanOrEqual(3)
    })

    it('does NOT count type-only fs imports (runtime-erased)', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            import type {Stats} from 'node:fs'
            export const measure = (s: Stats) => s.size
        `)
        const report = analyzeFile(sf)
        expect(report.byCategory.fs ?? 0).toBe(0)
    })

    it('treats `path` as path-io ONLY when the file also imports fs', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const pureSf = project.createSourceFile('/virtual/pure.ts', `
            import {join, dirname} from 'node:path'
            export const childDir = (p: string, child: string) => join(dirname(p), child)
        `)
        const pureReport = analyzeFile(pureSf)
        expect(pureReport.byCategory['path-io'] ?? 0).toBe(0)

        const ioSf = project.createSourceFile('/virtual/io.ts', `
            import {readFileSync} from 'node:fs'
            import {join} from 'node:path'
            export const readChild = (root: string, child: string) =>
                readFileSync(join(root, child), 'utf8')
        `)
        const ioReport = analyzeFile(ioSf)
        expect(ioReport.byCategory['path-io']).toBeGreaterThan(0)
    })

    it('drops `console.*` calls (report tier — not counted)', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const log = (m: string) => {
                console.log(m)
                console.error(m)
                console.warn(m)
            }
        `)
        const report = analyzeFile(sf)
        // console is in the REPORT tier — dropped from counts entirely so
        // that logging churn doesn't move the gated score.
        expect(report.byCategory.console).toBeUndefined()
        expect(report.total).toBe(0)
    })

    it('counts `process.env` + `process.argv` under `process`', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const home = () => process.env.HOME
            export const argv = () => process.argv.slice(2)
        `)
        const report = analyzeFile(sf)
        expect(report.byCategory.process).toBe(2)
    })

    it('counts `Date.now()` and `new Date()` (zero-arg) under `time`', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const stamp = () => Date.now()
            export const start = () => new Date()
            export const parsed = () => new Date('2026-01-01')
        `)
        const report = analyzeFile(sf)
        // Date.now() → 1 ; new Date() (no args) → 1 ; new Date('iso') → 0
        expect(report.byCategory.time).toBe(2)
    })

    it('counts `Math.random()` under `random` (but NOT Math.PI)', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const r = () => Math.random()
            export const pi = () => Math.PI
        `)
        const report = analyzeFile(sf)
        expect(report.byCategory.random).toBe(1)
    })

    it('counts setTimeout/setInterval under `timer`', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const later = () => setTimeout(() => {}, 10)
            export const recur = () => setInterval(() => {}, 100)
        `)
        const report = analyzeFile(sf)
        expect(report.byCategory.timer).toBe(2)
    })

    it('counts fetch + node:http imports under `network`', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            import * as http from 'node:http'
            export const ping = () => fetch('https://example.com')
            export const local = () => http.createServer()
        `)
        const report = analyzeFile(sf)
        // 1 import + 1 http usage + 1 fetch usage
        expect(report.byCategory.network).toBeGreaterThanOrEqual(3)
    })

    it('counts `import(...)` dynamic imports under `dynamic-import`', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const lazy = () => import('./other.ts')
            export const lazy2 = () => import('./other2.ts')
        `)
        const report = analyzeFile(sf)
        expect(report.byCategory['dynamic-import']).toBe(2)
    })

    it('detects leaky-shell: strict-tier usage outside any env-taking function', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            import {readFileSync} from 'node:fs'
            // Top-level usage AND a function with no env parameter — both leaky.
            const eagerData = readFileSync('/etc/hostname', 'utf8')
            export const dump = (path: string) => readFileSync(path, 'utf8')
        `)
        const report = analyzeFile(sf)
        // 2 usage sites (eager top-level read + dump call), both leaky.
        expect(report.leakyStrict).toBe(2)
    })

    it('does NOT flag leaky when strict use lives inside an env-taking function', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            import {readFileSync} from 'node:fs'
            export const dump = (env: {root: string}, path: string) =>
                readFileSync(env.root + path, 'utf8')
        `)
        const report = analyzeFile(sf)
        // Usage is inside a function that takes 'env' — Pattern 3 applied.
        expect(report.leakyStrict).toBe(0)
    })

    it('does NOT count parameter shadows (param named `fs`)', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const write = (fs: {append: (p: string, d: string) => void}, p: string, d: string) =>
                fs.append(p, d)
        `)
        const report = analyzeFile(sf)
        expect(report.byCategory.fs ?? 0).toBe(0)
        expect(report.total).toBe(0)
    })
})

// --- measure.run() ---

describe('implicit-globals measure', () => {
    it('passes when touched files are pure', async () => {
        const subgraph = buildSubgraph(
            [{path: '/virtual/pkg/src/pure/a.ts', community: 'pkg/pure',
                content: 'export const add = (a: number, b: number) => a + b\n'}],
            ['pkg/pure'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        expect(result.perCommunity).toEqual({'pkg/pure': 0})
        expect(result.violations).toEqual([])
    })

    it('reports strict + advisory breakdown in the violation message', async () => {
        const subgraph = buildSubgraph(
            [{
                path: '/virtual/pkg/src/shell/a.ts', community: 'pkg/shell',
                content: `
                    import {readFileSync} from 'node:fs'
                    export const dump = () => {
                        console.log('starting')
                        const data = readFileSync('/tmp/x', 'utf8')
                        console.log('done')
                        return Date.now()
                    }
                `,
            }],
            ['pkg/shell'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        // perCommunity is the strict-tier sum: fs import + readFileSync usage = 2
        expect(result.perCommunity['pkg/shell']).toBeGreaterThan(0)
        // 2 is well below the threshold (854, set to the historical
        // per-community max). No violation at this score; gate fires
        // only when strict > 854.
        expect(result.violations).toEqual([])
    })

    it('does NOT count console (report tier) in perCommunity', async () => {
        const subgraph = buildSubgraph(
            [
                {path: '/virtual/pkg/src/shell/a.ts', community: 'pkg/shell',
                    content: `export const log = (m: string) => console.log(m)\n`},
                {path: '/virtual/pkg/src/shell/b.ts', community: 'pkg/shell',
                    content: `export const err = (m: string) => console.error(m)\n`},
            ],
            ['pkg/shell'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        // Console alone has zero strict + zero advisory ⇒ no score, no violation.
        expect(result.perCommunity['pkg/shell']).toBe(0)
        expect(result.violations).toEqual([])
    })

    it('aggregates strict-tier counts per community across files', async () => {
        const subgraph = buildSubgraph(
            [
                {path: '/virtual/pkg/src/shell/a.ts', community: 'pkg/shell',
                    content: `import {readFileSync} from 'node:fs'\nexport const r1 = () => readFileSync('/a', 'utf8')\n`},
                {path: '/virtual/pkg/src/shell/b.ts', community: 'pkg/shell',
                    content: `import {writeFileSync} from 'node:fs'\nexport const w = () => writeFileSync('/b', 'x')\n`},
            ],
            ['pkg/shell'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        // Each file: 1 import (fs) + 1 usage = 2 strict; sum = 4
        expect(result.perCommunity['pkg/shell']).toBe(4)
    })

    it('does not gate on advisory-only communities (strict=0)', async () => {
        const subgraph = buildSubgraph(
            [{
                path: '/virtual/pkg/src/util/a.ts', community: 'pkg/util',
                content: `export const stamp = () => Date.now()\n`,
            }],
            ['pkg/util'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        // perCommunity = 0 (no strict). Under the threshold-only model
        // advisory is informational; no violation is emitted.
        expect(result.perCommunity['pkg/util']).toBe(0)
        expect(result.violations).toEqual([])
    })

    it('skips files in untouched neighbor communities', async () => {
        const subgraph = buildSubgraph(
            [
                {path: '/virtual/pkg/src/touched/clean.ts', community: 'pkg/touched',
                    content: 'export const add = (a: number, b: number) => a + b\n'},
                {path: '/virtual/pkg/src/neighbor/dirty.ts', community: 'pkg/neighbor',
                    content: `import {readFileSync} from 'node:fs'\nexport const r = () => readFileSync('/tmp', 'utf8')\n`},
            ],
            ['pkg/touched'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        expect(result.perCommunity).toEqual({'pkg/touched': 0})
        expect(result.violations).toEqual([])
    })

    it('exposes the canonical SubgraphMeasure surface contract', () => {
        expect(measure.id).toBe(MEASURE_ID)
        expect(measure.axis).toBe('behavioral')
        expect(measure.scope).toBe('file')
        expect(measure.needsTsMorph).toBe(true)
        expect(measure.needsInbound).toBe(false)
    })
})
