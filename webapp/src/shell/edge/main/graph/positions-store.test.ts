/**
 * Unit tests for positions-store.ts
 *
 * Tests the 3 exported functions directly:
 * - loadPositions: reads .voicetree/positions.json → Map
 * - mergePositionsIntoGraph: merges positions into graph nodes
 * - savePositionsSync: writes positions to .voicetree/positions.json
 */

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, Position } from '@/pure/graph'
import { createGraph } from '@/pure/graph/createGraph'
import { loadPositions, mergePositionsIntoGraph, savePositionsSync } from './positions-store'

// ─── Helpers ──────────────────────────────────────────────────────────

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'positions-store-test-'))
}

function makeNode(id: string, position: O.Option<Position>): GraphNode {
    return {
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${id}`,
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position,
            additionalYAMLProps: new Map(),
            isContextNode: false
        }
    }
}

// ─── Cleanup ──────────────────────────────────────────────────────────

const tmpDirs: string[] = []

afterEach(() => {
    for (const dir of tmpDirs) {
        fs.rmSync(dir, { recursive: true, force: true })
    }
    tmpDirs.length = 0
})

// ─── loadPositions ────────────────────────────────────────────────────

describe('loadPositions', () => {
    it('returns empty Map when file does not exist', async () => {
        const tmp: string = makeTmpDir()
        tmpDirs.push(tmp)

        const result: ReadonlyMap<string, Position> = await loadPositions(tmp)

        expect(result.size).toBe(0)
    })

    it('returns empty Map when JSON is corrupted', async () => {
        const tmp: string = makeTmpDir()
        tmpDirs.push(tmp)
        const voicetreeDir: string = path.join(tmp, '.voicetree')
        fs.mkdirSync(voicetreeDir)
        fs.writeFileSync(path.join(voicetreeDir, 'positions.json'), '{not valid json!!!', 'utf-8')

        const result: ReadonlyMap<string, Position> = await loadPositions(tmp)

        expect(result.size).toBe(0)
    })

    it('returns correct Map entries from valid JSON', async () => {
        const tmp: string = makeTmpDir()
        tmpDirs.push(tmp)
        const voicetreeDir: string = path.join(tmp, '.voicetree')
        fs.mkdirSync(voicetreeDir)

        const positionsData: Record<string, { x: number; y: number }> = {
            '/path/to/node-a.md': { x: 100, y: 200 },
            '/path/to/node-b.md': { x: -50, y: 300.5 }
        }
        fs.writeFileSync(path.join(voicetreeDir, 'positions.json'), JSON.stringify(positionsData), 'utf-8')

        const result: ReadonlyMap<string, Position> = await loadPositions(tmp)

        expect(result.size).toBe(2)
        expect(result.get('/path/to/node-a.md')).toEqual({ x: 100, y: 200 })
        expect(result.get('/path/to/node-b.md')).toEqual({ x: -50, y: 300.5 })
    })

    it('filters out entries with non-number x/y', async () => {
        const tmp: string = makeTmpDir()
        tmpDirs.push(tmp)
        const voicetreeDir: string = path.join(tmp, '.voicetree')
        fs.mkdirSync(voicetreeDir)

        const positionsData: Record<string, unknown> = {
            'good.md': { x: 10, y: 20 },
            'bad-x.md': { x: 'not a number', y: 20 },
            'bad-y.md': { x: 10, y: null },
            'missing-xy.md': { color: 'red' },
            'also-good.md': { x: 0, y: 0 }
        }
        fs.writeFileSync(path.join(voicetreeDir, 'positions.json'), JSON.stringify(positionsData), 'utf-8')

        const result: ReadonlyMap<string, Position> = await loadPositions(tmp)

        expect(result.size).toBe(2)
        expect(result.get('good.md')).toEqual({ x: 10, y: 20 })
        expect(result.get('also-good.md')).toEqual({ x: 0, y: 0 })
        expect(result.has('bad-x.md')).toBe(false)
        expect(result.has('bad-y.md')).toBe(false)
        expect(result.has('missing-xy.md')).toBe(false)
    })
})

// ─── mergePositionsIntoGraph ──────────────────────────────────────────

describe('mergePositionsIntoGraph', () => {
    it('returns same graph when positions map is empty', () => {
        const node: GraphNode = makeNode('a.md', O.some({ x: 1, y: 2 }))
        const graph: Graph = createGraph({ 'a.md': node })
        const emptyPositions: ReadonlyMap<string, Position> = new Map()

        const result: Graph = mergePositionsIntoGraph(graph, emptyPositions)

        // Should be reference-equal (early return)
        expect(result).toBe(graph)
    })

    it('overrides existing node positions with JSON positions', () => {
        const node: GraphNode = makeNode('a.md', O.some({ x: 1, y: 2 }))
        const graph: Graph = createGraph({ 'a.md': node })
        const positions: ReadonlyMap<string, Position> = new Map([
            ['a.md', { x: 999, y: 888 }]
        ])

        const result: Graph = mergePositionsIntoGraph(graph, positions)

        expect(O.isSome(result.nodes['a.md'].nodeUIMetadata.position)).toBe(true)
        if (O.isSome(result.nodes['a.md'].nodeUIMetadata.position)) {
            expect(result.nodes['a.md'].nodeUIMetadata.position.value).toEqual({ x: 999, y: 888 })
        }
    })

    it('nodes without matching position keep their existing position', () => {
        const nodeA: GraphNode = makeNode('a.md', O.some({ x: 1, y: 2 }))
        const nodeB: GraphNode = makeNode('b.md', O.some({ x: 50, y: 60 }))
        const graph: Graph = createGraph({ 'a.md': nodeA, 'b.md': nodeB })

        // Only override a.md, not b.md
        const positions: ReadonlyMap<string, Position> = new Map([
            ['a.md', { x: 100, y: 200 }]
        ])

        const result: Graph = mergePositionsIntoGraph(graph, positions)

        // a.md should be overridden
        if (O.isSome(result.nodes['a.md'].nodeUIMetadata.position)) {
            expect(result.nodes['a.md'].nodeUIMetadata.position.value).toEqual({ x: 100, y: 200 })
        }

        // b.md should keep its original position
        if (O.isSome(result.nodes['b.md'].nodeUIMetadata.position)) {
            expect(result.nodes['b.md'].nodeUIMetadata.position.value).toEqual({ x: 50, y: 60 })
        }
    })
})

// ─── savePositionsSync ────────────────────────────────────────────────

describe('savePositionsSync', () => {
    it('writes correct JSON with rounded coordinates', () => {
        const tmp: string = makeTmpDir()
        tmpDirs.push(tmp)

        const node: GraphNode = makeNode('node.md', O.some({ x: 123.7, y: -456.3 }))
        const graph: Graph = createGraph({ 'node.md': node })

        savePositionsSync(graph, tmp)

        const filePath: string = path.join(tmp, '.voicetree', 'positions.json')
        const written: string = fs.readFileSync(filePath, 'utf-8')
        const parsed: Record<string, { x: number; y: number }> = JSON.parse(written)

        expect(parsed['node.md']).toEqual({ x: 124, y: -456 })
    })

    it('creates .voicetree directory if missing', () => {
        const tmp: string = makeTmpDir()
        tmpDirs.push(tmp)

        const voicetreeDir: string = path.join(tmp, '.voicetree')
        expect(fs.existsSync(voicetreeDir)).toBe(false)

        const node: GraphNode = makeNode('node.md', O.some({ x: 0, y: 0 }))
        const graph: Graph = createGraph({ 'node.md': node })

        savePositionsSync(graph, tmp)

        expect(fs.existsSync(voicetreeDir)).toBe(true)
        expect(fs.existsSync(path.join(voicetreeDir, 'positions.json'))).toBe(true)
    })

    it('skips nodes without positions', () => {
        const tmp: string = makeTmpDir()
        tmpDirs.push(tmp)

        const withPos: GraphNode = makeNode('has-pos.md', O.some({ x: 10, y: 20 }))
        const withoutPos: GraphNode = makeNode('no-pos.md', O.none)
        const graph: Graph = createGraph({ 'has-pos.md': withPos, 'no-pos.md': withoutPos })

        savePositionsSync(graph, tmp)

        const filePath: string = path.join(tmp, '.voicetree', 'positions.json')
        const parsed: Record<string, { x: number; y: number }> = JSON.parse(fs.readFileSync(filePath, 'utf-8'))

        expect(parsed['has-pos.md']).toEqual({ x: 10, y: 20 })
        expect(parsed['no-pos.md']).toBeUndefined()
    })
})
