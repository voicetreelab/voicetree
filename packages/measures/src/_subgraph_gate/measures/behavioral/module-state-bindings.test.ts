/**
 * Black-box tests for the `module-state-bindings` measure.
 *
 * Strategy: build an in-memory ts-morph project (no disk I/O), wrap it in
 * a minimal {@link ParsedSubgraph} shape, and assert on `perCommunity` +
 * `violations` from the public `measure.run()` entry point.
 *
 * We do NOT mock any internals — the measure is called as a black box
 * via its `SubgraphMeasure.run` contract.
 */
import {Project} from 'ts-morph'
import {describe, expect, it} from 'vitest'
import {measure, findModuleStateBindings, MEASURE_ID} from './module-state-bindings.ts'
import type {ParsedSubgraph} from '../../../_shared/graph/parse-subgraph.ts'
import type {SourceFile as SubgraphSourceFile} from '../../../_shared/graph/import-graph.ts'

// --- Test harness ---

type FixtureFile = {
    readonly path: string         // absolute-looking path, e.g. /virtual/pkg/src/state/counter.ts
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

// --- findModuleStateBindings (pure unit) ---

describe('findModuleStateBindings', () => {
    it('flags a single top-level `let`', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            let counter = 0
            export const tick = () => counter + 1
        `)
        const bindings = findModuleStateBindings(sf)
        expect(bindings.map(b => ({name: b.name, kind: b.kind})))
            .toEqual([{name: 'counter', kind: 'let'}])
    })

    it('flags top-level `var` and treats it distinctly from let', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            var legacy = []
            let modern = new Map()
        `)
        const bindings = findModuleStateBindings(sf)
        expect(bindings.map(b => ({name: b.name, kind: b.kind})))
            .toEqual([{name: 'legacy', kind: 'var'}, {name: 'modern', kind: 'let'}])
    })

    it('ignores `const` even when the initializer is mutable', () => {
        // Intentional: this measure is the strict visibility precondition.
        // The broader behavioral-complexity test catches mutable-container consts;
        // here we only care about the binding's mutability, not the value's.
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            const cache = new Map()
            const items = []
            const config = {x: 1}
        `)
        expect(findModuleStateBindings(sf)).toEqual([])
    })

    it('ignores `let` inside a function body', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            export function tick(state: {n: number}) {
                let local = state.n
                local++
                return {n: local}
            }
        `)
        expect(findModuleStateBindings(sf)).toEqual([])
    })

    it('flags destructured top-level `let` bindings (each leaf binding)', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `
            let [a, b] = [1, 2]
            let {c, d: renamed} = {c: 1, d: 2}
        `)
        const names = findModuleStateBindings(sf).map(b => b.name).sort()
        expect(names).toEqual(['a', 'b', 'c', 'renamed'])
    })

    it('records line numbers for surfaced bindings', () => {
        const project = new Project({useInMemoryFileSystem: true})
        const sf = project.createSourceFile('/virtual/a.ts', `let foo = 1\nlet bar = 2\n`)
        const bindings = findModuleStateBindings(sf)
        expect(bindings.map(b => ({name: b.name, line: b.line})))
            .toEqual([{name: 'foo', line: 1}, {name: 'bar', line: 2}])
    })
})

// --- measure.run() (black-box, integrated through SubgraphMeasure shape) ---

describe('module-state-bindings measure', () => {
    it('passes (no violations) when touched files have no top-level mutables', async () => {
        const subgraph = buildSubgraph(
            [
                {path: '/virtual/pkg/src/clean/a.ts', community: 'pkg/clean',
                    content: `export const tick = (s: number) => s + 1\n`},
                {path: '/virtual/pkg/src/clean/b.ts', community: 'pkg/clean',
                    content: `const cache: ReadonlyMap<string, number> = new Map()\nexport const get = (k: string) => cache.get(k) ?? 0\n`},
            ],
            ['pkg/clean'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        expect(result.measureId).toBe(MEASURE_ID)
        expect(result.perCommunity).toEqual({'pkg/clean': 0})
        expect(result.violations).toEqual([])
    })

    it('counts top-level mutable bindings per touched file', async () => {
        const subgraph = buildSubgraph(
            [
                {path: '/virtual/pkg/src/state/counter.ts', community: 'pkg/state',
                    content: `let count = 0\nexport const tick = () => ++count\n`},
                {path: '/virtual/pkg/src/state/store.ts', community: 'pkg/state',
                    content: `let cache: Record<string, number> = {}\nexport const put = (k: string, v: number) => { cache[k] = v }\n`},
            ],
            ['pkg/state'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        expect(result.perCommunity['pkg/state']).toBe(2)
        // 2 bindings is below the threshold (71, set to the historical
        // per-community max so existing grandfathered communities can be
        // touched). No violation at this score.
        expect(result.violations).toEqual([])
    })

    it('sums bindings across multiple files within a single touched community', async () => {
        const subgraph = buildSubgraph(
            [
                {path: '/virtual/pkg/src/state/a.ts', community: 'pkg/state',
                    content: `let one = 1; let two = 2\n`},
                {path: '/virtual/pkg/src/state/b.ts', community: 'pkg/state',
                    content: `let three = 3\n`},
            ],
            ['pkg/state'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        expect(result.perCommunity['pkg/state']).toBe(3)
    })

    it('skips files that live in untouched neighbor communities', async () => {
        // Even if a neighbor community has plenty of `let`s, we don't count
        // them — the gate only judges what's being changed RIGHT NOW.
        const subgraph = buildSubgraph(
            [
                {path: '/virtual/pkg/src/touched/clean.ts', community: 'pkg/touched',
                    content: `export const tick = (s: number) => s + 1\n`},
                {path: '/virtual/pkg/src/neighbor/dirty.ts', community: 'pkg/neighbor',
                    content: `let leaked = 0\nlet alsoLeaked = 1\n`},
            ],
            ['pkg/touched'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        expect(result.perCommunity).toEqual({'pkg/touched': 0})
        expect(result.violations).toEqual([])
    })

    it('reports a per-community entry of 0 for every touched community even when clean', async () => {
        // Aggregation contract from subgraph-measure.ts requires this so the
        // baseline-diff loop can detect "regressed from 0 to 1".
        const subgraph = buildSubgraph(
            [{path: '/virtual/pkg/src/clean/a.ts', community: 'pkg/clean',
                content: 'export const f = (x: number) => x\n'}],
            ['pkg/clean', 'pkg/empty'],
        )
        const result = await measure.run({changedFiles: [], parsedSubgraph: subgraph})
        expect(Object.keys(result.perCommunity).sort()).toEqual(['pkg/clean', 'pkg/empty'])
        expect(result.perCommunity['pkg/clean']).toBe(0)
        expect(result.perCommunity['pkg/empty']).toBe(0)
    })

    it('exposes the canonical SubgraphMeasure surface contract', () => {
        expect(measure.id).toBe(MEASURE_ID)
        expect(measure.axis).toBe('behavioral')
        expect(measure.scope).toBe('file')
        expect(measure.needsTsMorph).toBe(true)
        expect(measure.needsInbound).toBe(false)
    })
})
