/**
 * Black-box tests for node-layout-io.ts — the single spatial-layout sidecar
 * (.voicetree/node-layout.json), covering position-only, size-only, both, and
 * empty cases, plus the save→load round-trip.
 */

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, Position, Size } from '@vt/graph-model/graph'
import { createGraph } from '@vt/graph-model/graph'
import { nodeLayoutIO } from '@vt/app-config/node-layout-io'

function makeTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'node-layout-io-test-'))
}

function makeNode(id: string, position: O.Option<Position>, size: O.Option<Size> = O.none): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${id}`,
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position,
            size,
            additionalYAMLProps: {},
            isContextNode: false,
        },
    }
}

const tmpDirs: string[] = []
afterEach(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
    tmpDirs.length = 0
})

function tmp(): string {
    const dir = makeTmpDir()
    tmpDirs.push(dir)
    return dir
}

function writeSidecar(dir: string, data: unknown): void {
    const vt = path.join(dir, '.voicetree')
    fs.mkdirSync(vt, { recursive: true })
    fs.writeFileSync(path.join(vt, 'node-layout.json'), JSON.stringify(data), 'utf-8')
}

function readSidecar(dir: string): Record<string, { x?: number; y?: number; w?: number; h?: number }> {
    return JSON.parse(fs.readFileSync(path.join(dir, '.voicetree', 'node-layout.json'), 'utf-8'))
}

describe('nodeLayoutIO.load', () => {
    it('returns empty Map when file does not exist', async () => {
        expect((await nodeLayoutIO.load(tmp())).size).toBe(0)
    })

    it('returns empty Map when JSON is corrupted', async () => {
        const dir = tmp()
        fs.mkdirSync(path.join(dir, '.voicetree'))
        fs.writeFileSync(path.join(dir, '.voicetree', 'node-layout.json'), '{not json!!', 'utf-8')
        expect((await nodeLayoutIO.load(dir)).size).toBe(0)
    })

    it('decodes a position-only record', async () => {
        const dir = tmp()
        writeSidecar(dir, { 'a.md': { x: 10, y: 20 } })
        const m = await nodeLayoutIO.load(dir)
        expect(m.get('a.md')).toEqual({ position: { x: 10, y: 20 } })
    })

    it('decodes a size-only record', async () => {
        const dir = tmp()
        writeSidecar(dir, { 'f.md': { w: 300, h: 200 } })
        const m = await nodeLayoutIO.load(dir)
        expect(m.get('f.md')).toEqual({ size: { width: 300, height: 200 } })
    })

    it('decodes a record carrying both position and size', async () => {
        const dir = tmp()
        writeSidecar(dir, { 'f.md': { x: 1, y: 2, w: 80, h: 48 } })
        const m = await nodeLayoutIO.load(dir)
        expect(m.get('f.md')).toEqual({ position: { x: 1, y: 2 }, size: { width: 80, height: 48 } })
    })

    it('drops malformed fields but keeps the valid half', async () => {
        const dir = tmp()
        writeSidecar(dir, {
            'pos-ok-size-bad.md': { x: 5, y: 6, w: 'nope', h: 10 },
            'all-bad.md': { x: 'a', w: null },
            'good.md': { x: 0, y: 0, w: 12, h: 12 },
        })
        const m = await nodeLayoutIO.load(dir)
        expect(m.get('pos-ok-size-bad.md')).toEqual({ position: { x: 5, y: 6 } })
        expect(m.has('all-bad.md')).toBe(false)
        expect(m.get('good.md')).toEqual({ position: { x: 0, y: 0 }, size: { width: 12, height: 12 } })
    })
})

describe('nodeLayoutIO.save', () => {
    it('writes position and size with rounded values', () => {
        const dir = tmp()
        const node = makeNode('f.md', O.some({ x: 123.7, y: -456.3 }), O.some({ width: 300.6, height: 199.2 }))
        nodeLayoutIO.save(createGraph({ 'f.md': node }), dir)
        expect(readSidecar(dir)['f.md']).toEqual({ x: 124, y: -456, w: 301, h: 199 })
    })

    it('writes a size-only record for a node with size but no position', () => {
        const dir = tmp()
        const node = makeNode('f.md', O.none, O.some({ width: 80, height: 48 }))
        nodeLayoutIO.save(createGraph({ 'f.md': node }), dir)
        expect(readSidecar(dir)['f.md']).toEqual({ w: 80, h: 48 })
    })

    it('skips nodes with neither position nor size', () => {
        const dir = tmp()
        const graph = createGraph({
            'has.md': makeNode('has.md', O.some({ x: 1, y: 1 })),
            'none.md': makeNode('none.md', O.none, O.none),
        })
        nodeLayoutIO.save(graph, dir)
        const parsed = readSidecar(dir)
        expect(parsed['has.md']).toEqual({ x: 1, y: 1 })
        expect(parsed['none.md']).toBeUndefined()
    })

    it('does not clobber a populated sidecar with an empty projection', () => {
        const dir = tmp()
        writeSidecar(dir, { 'keep.md': { x: 7, y: 8 } })
        // Graph has no spatial layout → projection is empty; must not wipe the file.
        nodeLayoutIO.save(createGraph({ 'plain.md': makeNode('plain.md', O.none) }), dir)
        expect(readSidecar(dir)).toEqual({ 'keep.md': { x: 7, y: 8 } })
    })
})

describe('nodeLayoutIO round-trip', () => {
    it('preserves position + size through save then load', async () => {
        const dir = tmp()
        const graph = createGraph({
            'leaf.md': makeNode('leaf.md', O.some({ x: 11, y: 22 })),
            'folder.md': makeNode('folder.md', O.some({ x: 1, y: 2 }), O.some({ width: 420, height: 360 })),
        })
        nodeLayoutIO.save(graph, dir)
        const m = await nodeLayoutIO.load(dir)
        expect(m.get('leaf.md')).toEqual({ position: { x: 11, y: 22 } })
        expect(m.get('folder.md')).toEqual({ position: { x: 1, y: 2 }, size: { width: 420, height: 360 } })
    })
})
