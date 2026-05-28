/**
 * Black-box tests for the `ast-purity-ratio` measure.
 *
 * Strategy mirrors the other behavioral tests: in-memory ts-morph projects
 * exercised through the public `SubgraphMeasure.run` contract.
 */
import {Project} from 'ts-morph'
import {describe, expect, it} from 'vitest'
import {measure, analyzeFile, MEASURE_ID} from './ast-purity-ratio.ts'
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

// --- analyzeFile (per-function classification) ---

describe('analyzeFile (ast-purity-ratio)', () => {
    it('classifies a pure function (no side effects, no mutation, no throw) as pure', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts',
            `export const add = (a: number, b: number) => a + b\n`)
        const report = analyzeFile(sf)
        expect(report.pureCount).toBe(1)
        expect(report.impureCount).toBe(0)
        expect(report.functions[0].classification).toBe('pure')
    })

    it('flags a function that uses console as impure', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts',
            `export const log = (m: string) => console.log(m)\n`)
        const report = analyzeFile(sf)
        expect(report.impureCount).toBe(1)
        expect(report.functions[0].impurityReasons).toContain('uses-global:console')
    })

    it('flags a function that imports + uses fs as impure', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            import {writeFileSync} from 'node:fs'
            export const dump = (p: string, d: string) => writeFileSync(p, d)
        `)
        const report = analyzeFile(sf)
        expect(report.impureCount).toBe(1)
        expect(report.functions[0].impurityReasons).toContain('uses-impure-import:writeFileSync')
    })

    it('flags a function that mutates one of its parameters (assignment)', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const tick = (state: {n: number}) => { state.n = state.n + 1; return state }
        `)
        const report = analyzeFile(sf)
        expect(report.impureCount).toBe(1)
        expect(report.functions[0].impurityReasons).toContain('mutates-param:assignment')
    })

    it('flags a function that calls a mutating method on a parameter', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const append = (xs: number[], x: number) => { xs.push(x); return xs }
        `)
        const report = analyzeFile(sf)
        expect(report.impureCount).toBe(1)
        expect(report.functions[0].impurityReasons).toContain('mutates-param:method-push')
    })

    it('flags a function with a throw statement as impure', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const assert = (cond: boolean) => {
                if (!cond) throw new Error('boom')
                return cond
            }
        `)
        const report = analyzeFile(sf)
        expect(report.impureCount).toBe(1)
        expect(report.functions[0].impurityReasons).toContain('throws')
    })

    it('flags a function that calls Date.now() as impure', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const stamp = () => Date.now()
        `)
        const report = analyzeFile(sf)
        expect(report.impureCount).toBe(1)
        expect(report.functions[0].impurityReasons).toContain('uses-chain:Date.now')
    })

    it('flags a function with Math.random() as impure', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const r = () => Math.random()
        `)
        const report = analyzeFile(sf)
        expect(report.impureCount).toBe(1)
        expect(report.functions[0].impurityReasons).toContain('uses-chain:Math.random')
    })

    it('does NOT flag a function that uses a parameter named fs', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export const write = (fs: {append: (p: string, d: string) => void}, p: string, d: string) =>
                fs.append(p, d)
        `)
        const report = analyzeFile(sf)
        expect(report.pureCount).toBe(1)
        expect(report.functions[0].classification).toBe('pure')
    })

    it('counts methods and arrow-in-property-assignment as functions', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            class Foo {
                tick(s: {n: number}) { return {n: s.n + 1} }
                burn() { console.log('side effect') }
            }
            export const handlers = {
                onClick: () => 1,
                onSave: () => console.log('save'),
            }
        `)
        const report = analyzeFile(sf)
        // 2 methods + 2 arrows in object literal = 4 functions
        expect(report.pureCount + report.impureCount).toBe(4)
        // burn() and onSave use console → 2 impure
        expect(report.impureCount).toBe(2)
    })

    it('treats overload signatures (no body) as pure (default-safe)', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export function get(k: 'a'): number
            export function get(k: 'b'): string
            export function get(k: string): unknown { return k }
        `)
        const report = analyzeFile(sf)
        // Three function declarations enumerated; two are signature-only (no body, pure),
        // one has a body that just returns its parameter → also pure.
        expect(report.impureCount).toBe(0)
    })
})

// --- measure.run() ---

describe('ast-purity-ratio measure', () => {
    it('passes a fully pure community (ratio = 0)', async () => {
        const subgraph = buildSubgraph(
            [{path: '/virtual/pkg/src/pure/a.ts', community: 'pkg/pure',
                content: `
                    export const add = (a: number, b: number) => a + b
                    export const mul = (a: number, b: number) => a * b
                    export const id = <T,>(x: T) => x
                `}],
            ['pkg/pure'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        expect(result.perCommunity['pkg/pure']).toBe(0)
        expect(result.violations).toEqual([])
    })

    it('warns on a community with ratio between 0.5 and 0.8 (default thresholds, no baseline)', async () => {
        // 2 pure, 4 impure → ratio = 4/6 = 0.667 → warn (between 0.5 and 0.8)
        const subgraph = buildSubgraph(
            [{path: '/virtual/pkg/src/mixed/a.ts', community: 'pkg/mixed',
                content: `
                    export const pure1 = (x: number) => x + 1
                    export const pure2 = (x: number) => x * 2
                    export const log1 = (m: string) => console.log(m)
                    export const log2 = (m: string) => console.error(m)
                    export const log3 = (m: string) => console.warn(m)
                    export const log4 = (m: string) => console.info(m)
                `}],
            ['pkg/mixed'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        const ratio = result.perCommunity['pkg/mixed']
        expect(ratio).toBeCloseTo(4 / 6, 5)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].severity).toBe('warn')
    })

    it('fails on a community with ratio > 0.8 (default thresholds, no baseline)', async () => {
        const subgraph = buildSubgraph(
            [{path: '/virtual/pkg/src/dirty/a.ts', community: 'pkg/dirty',
                content: `
                    export const log1 = (m: string) => console.log(m)
                    export const log2 = (m: string) => console.error(m)
                    export const log3 = (m: string) => console.warn(m)
                    export const log4 = (m: string) => console.info(m)
                    export const log5 = (m: string) => console.debug(m)
                    export const pure1 = (x: number) => x + 1
                `}],
            ['pkg/dirty'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        const ratio = result.perCommunity['pkg/dirty']
        expect(ratio).toBeCloseTo(5 / 6, 5)
        expect(result.violations).toHaveLength(1)
        expect(result.violations[0].severity).toBe('fail')
        expect(result.violations[0].message).toMatch(/FP pattern 1/)
    })

    it('returns 0 (not NaN) for a touched community with zero functions', async () => {
        const subgraph = buildSubgraph(
            [{path: '/virtual/pkg/src/empty/a.ts', community: 'pkg/empty',
                content: `export const k = 42\n`}],
            ['pkg/empty'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        expect(result.perCommunity['pkg/empty']).toBe(0)
        expect(result.violations).toEqual([])
    })

    it('aggregates pure/impure counts across multiple files in the same community', async () => {
        const subgraph = buildSubgraph(
            [
                {path: '/virtual/pkg/src/c/a.ts', community: 'pkg/c',
                    content: `export const p = (x: number) => x\n`},
                {path: '/virtual/pkg/src/c/b.ts', community: 'pkg/c',
                    content: `export const q = () => console.log('hi')\n`},
            ],
            ['pkg/c'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        // 1 pure + 1 impure = 0.5 ratio (boundary; passes default threshold)
        expect(result.perCommunity['pkg/c']).toBe(0.5)
        expect(result.violations).toEqual([])
    })

    it('skips files in untouched neighbor communities', async () => {
        const subgraph = buildSubgraph(
            [
                {path: '/virtual/pkg/src/touched/a.ts', community: 'pkg/touched',
                    content: `export const f = (x: number) => x\n`},
                {path: '/virtual/pkg/src/neighbor/b.ts', community: 'pkg/neighbor',
                    content: `export const dirty = () => console.log('hi')\n`},
            ],
            ['pkg/touched'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        expect(result.perCommunity).toEqual({'pkg/touched': 0})
    })

    it('exposes the canonical SubgraphMeasure surface contract', () => {
        expect(measure.id).toBe(MEASURE_ID)
        expect(measure.axis).toBe('behavioral')
        expect(measure.scope).toBe('file')
        expect(measure.needsTsMorph).toBe(true)
        expect(measure.needsInbound).toBe(false)
    })
})
