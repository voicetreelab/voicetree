import {describe, expect, it} from 'vitest'
import {
    buildUndirectedImportIndex,
    importIndexStats,
    MAX_IMPORT_DISTANCE,
    shortestImportDistance,
} from './import-distance.ts'
import type {ImportGraph, SourceFile} from './import-graph.ts'

function file(relativePath: string): SourceFile {
    return {
        absolutePath: `/virtual/${relativePath}`,
        relativePath,
        relToSrc: relativePath,
        packageName: relativePath.split('/')[0],
    }
}

function graph(files: readonly SourceFile[], edges: ReadonlyArray<readonly [string, string]>): ImportGraph {
    const byRel = new Map(files.map(f => [f.relativePath, f]))
    return {
        files,
        edges: edges.map(([from, to]) => {
            const fromFile = byRel.get(from)
            const toFile = byRel.get(to)
            if (!fromFile || !toFile) throw new Error(`fixture edge references missing file: ${from} → ${to}`)
            return {from: fromFile, to: toFile}
        }),
    }
}

describe('shortestImportDistance', () => {
    it('returns 0 for the same file', () => {
        const idx = buildUndirectedImportIndex(graph([file('a.ts')], []))
        expect(shortestImportDistance(idx, 'a.ts', 'a.ts')).toBe(0)
    })

    it('returns 1 when one module imports the other', () => {
        const idx = buildUndirectedImportIndex(graph(
            [file('a.ts'), file('b.ts')],
            [['a.ts', 'b.ts']],
        ))
        expect(shortestImportDistance(idx, 'a.ts', 'b.ts')).toBe(1)
        expect(shortestImportDistance(idx, 'b.ts', 'a.ts')).toBe(1)
    })

    it('walks a chain of N imports as distance N', () => {
        const idx = buildUndirectedImportIndex(graph(
            [file('a.ts'), file('b.ts'), file('c.ts'), file('d.ts')],
            [['a.ts', 'b.ts'], ['b.ts', 'c.ts'], ['c.ts', 'd.ts']],
        ))
        expect(shortestImportDistance(idx, 'a.ts', 'd.ts')).toBe(3)
    })

    it('finds the shortest path when multiple routes exist', () => {
        const idx = buildUndirectedImportIndex(graph(
            [file('a.ts'), file('b.ts'), file('c.ts'), file('d.ts')],
            [
                ['a.ts', 'b.ts'],
                ['b.ts', 'c.ts'],
                ['c.ts', 'd.ts'],
                ['a.ts', 'd.ts'],
            ],
        ))
        expect(shortestImportDistance(idx, 'a.ts', 'd.ts')).toBe(1)
    })

    it('caps at MAX_IMPORT_DISTANCE for unreachable pairs', () => {
        const idx = buildUndirectedImportIndex(graph(
            [file('island1.ts'), file('island2.ts')],
            [],
        ))
        expect(shortestImportDistance(idx, 'island1.ts', 'island2.ts')).toBe(MAX_IMPORT_DISTANCE)
    })

    it('caps at MAX_IMPORT_DISTANCE when an endpoint is missing from the index', () => {
        const idx = buildUndirectedImportIndex(graph([file('a.ts')], []))
        expect(shortestImportDistance(idx, 'a.ts', 'missing.ts')).toBe(MAX_IMPORT_DISTANCE)
        expect(shortestImportDistance(idx, 'missing.ts', 'a.ts')).toBe(MAX_IMPORT_DISTANCE)
    })

    it('caps at MAX_IMPORT_DISTANCE for paths longer than the cap', () => {
        const nodes = Array.from({length: MAX_IMPORT_DISTANCE + 3}, (_, idx2) => file(`n${idx2}.ts`))
        const edges: Array<readonly [string, string]> = []
        for (let i = 0; i < nodes.length - 1; i += 1) {
            edges.push([nodes[i].relativePath, nodes[i + 1].relativePath])
        }
        const idx = buildUndirectedImportIndex(graph(nodes, edges))
        const dist = shortestImportDistance(idx, nodes[0].relativePath, nodes[nodes.length - 1].relativePath)
        expect(dist).toBe(MAX_IMPORT_DISTANCE)
    })

    it('treats the graph as undirected — a→b vs b→a yields the same distance', () => {
        const idx = buildUndirectedImportIndex(graph(
            [file('a.ts'), file('b.ts'), file('c.ts')],
            [['c.ts', 'b.ts'], ['b.ts', 'a.ts']],
        ))
        expect(shortestImportDistance(idx, 'a.ts', 'c.ts'))
            .toBe(shortestImportDistance(idx, 'c.ts', 'a.ts'))
    })

    it('deduplicates parallel edges in the index stats', () => {
        const idx = buildUndirectedImportIndex(graph(
            [file('a.ts'), file('b.ts')],
            [['a.ts', 'b.ts'], ['b.ts', 'a.ts']],
        ))
        const stats = importIndexStats(idx)
        expect(stats.vertices).toBe(2)
        expect(stats.edges).toBe(1)
    })
})
