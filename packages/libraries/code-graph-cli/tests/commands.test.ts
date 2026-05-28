/**
 * Black-box tests for the command-layer functions.
 *
 * The fixture under tests/fixtures/simple is:
 *
 *   a() ─► b() ─► leaf()
 *    └───► c() ─► leaf()
 *   unused()                (no callers, no callees)
 *
 * Expected derived values:
 *   - a fanIn=0  fanOut=2 reachable={b,c,leaf}=3
 *   - b fanIn=1  fanOut=1 reachable={leaf}=1
 *   - c fanIn=1  fanOut=1 reachable={leaf}=1
 *   - leaf fanIn=2 fanOut=0 reachable={}=0
 *   - unused fanIn=0 fanOut=0 reachable={}=0
 */
import {beforeAll, describe, expect, test} from 'vitest'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'
import {callers} from '../src/commands/callers.ts'
import {callees} from '../src/commands/callees.ts'
import {findSymbol} from '../src/commands/find-symbol.ts'
import {hotspots} from '../src/commands/hotspots.ts'
import {imports} from '../src/commands/imports.ts'
import {reachable} from '../src/commands/reachable.ts'
import {loadGraph, type CallGraph} from '../src/graph/load-graph.ts'

const TEST_DIR: string = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT: string = join(TEST_DIR, 'fixtures/simple')

let graph: CallGraph

beforeAll(async () => {
    graph = await loadGraph({
        mode: 'paths',
        globs: [`${FIXTURE_ROOT}/src/**/*.ts`],
        rootDir: FIXTURE_ROOT,
    })
})

describe('findSymbol', () => {
    test('exact match returns the unique function', () => {
        const matches = findSymbol(graph, 'leaf')
        expect(matches).toHaveLength(1)
        expect(matches[0]).toMatchObject({name: 'leaf', file: 'src/leaf.ts', kind: 'function'})
    })

    test('prefix match returns multiple', () => {
        const matches = findSymbol(graph, 'u', 'prefix')
        expect(matches.map(m => m.name)).toEqual(['unused'])
    })

    test('regex match works', () => {
        const matches = findSymbol(graph, '^[abc]$', 'regex')
        expect(matches.map(m => m.name).sort()).toEqual(['a', 'b', 'c'])
    })

    test('no match returns empty', () => {
        expect(findSymbol(graph, 'nope')).toEqual([])
    })
})

describe('callers / callees', () => {
    const idFor = (name: string): string => findSymbol(graph, name)[0]!.id

    test('callers of leaf are b and c', () => {
        const names = callers(graph, idFor('leaf')).map(n => n.name).sort()
        expect(names).toEqual(['b', 'c'])
    })

    test('callees of a are b and c', () => {
        const names = callees(graph, idFor('a')).map(n => n.name).sort()
        expect(names).toEqual(['b', 'c'])
    })

    test('unused function has no edges', () => {
        const id = idFor('unused')
        expect(callers(graph, id)).toEqual([])
        expect(callees(graph, id)).toEqual([])
    })

    test('throws on unknown fnId', () => {
        expect(() => callers(graph, 'nope:1:foo')).toThrow(/Unknown function id/)
    })
})

describe('reachable', () => {
    const idFor = (name: string): string => findSymbol(graph, name)[0]!.id

    test('a reaches b, c, and leaf', () => {
        const names = reachable(graph, idFor('a')).map(n => n.name).sort()
        expect(names).toEqual(['b', 'c', 'leaf'])
    })

    test('leaf reaches nothing', () => {
        expect(reachable(graph, idFor('leaf'))).toEqual([])
    })
})

describe('imports', () => {
    test('a.ts imports b.ts and c.ts with resolved targets', () => {
        const result = imports(graph, 'src/a.ts', FIXTURE_ROOT)
        const specs = result.imports.map(i => i.specifier).sort()
        expect(specs).toEqual(['./b.ts', './c.ts'])
        for (const record of result.imports) {
            expect(record.resolvedFile).toMatch(/src\/[bc]\.ts$/)
            expect(record.isTypeOnly).toBe(false)
        }
    })

    test('throws on file not in graph', () => {
        expect(() => imports(graph, 'src/missing.ts', FIXTURE_ROOT)).toThrow(/not in graph/)
    })
})

describe('hotspots', () => {
    test('rankings reflect graph shape', () => {
        const report = hotspots(graph, 5)
        // a, b, c, leaf all have coupling 2; unused has coupling 0 and must be last.
        const top4 = report.byCoupling.slice(0, 4).map(r => r.name).sort()
        expect(top4).toEqual(['a', 'b', 'c', 'leaf'])
        expect(report.byCoupling.at(-1)).toMatchObject({name: 'unused', coupling: 0})

        // Only `a` reaches 3 nodes (b, c, leaf).
        expect(report.byReachableSize[0]).toMatchObject({name: 'a', reachableSize: 3})
        // Only `a` has fanOut 2.
        expect(report.byFanOut[0]).toMatchObject({name: 'a', fanOut: 2})
        // Only `leaf` has fanIn 2.
        const leaf = report.byCoupling.find(r => r.name === 'leaf')
        expect(leaf).toMatchObject({fanIn: 2, fanOut: 0})
    })

    test('totals match graph size', () => {
        const report = hotspots(graph, 50)
        expect(report.totals.functions).toBe(5) // a, b, c, leaf, unused
        expect(report.totals.edges).toBe(4) // a→b, a→c, b→leaf, c→leaf
    })

    test('folder rollup groups by top-level folder', () => {
        const report = hotspots(graph, 50)
        const folders = report.byFolderCoupling.map(f => f.folder)
        expect(folders).toContain('src')
    })
})
