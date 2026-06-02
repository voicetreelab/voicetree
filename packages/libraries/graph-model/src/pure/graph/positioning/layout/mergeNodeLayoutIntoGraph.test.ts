import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { mergeNodeLayoutIntoGraph } from './mergeNodeLayoutIntoGraph'
import type { Graph, GraphNode, NodeLayout, NodeIdAndFilePath } from '../..'

function leaf(id: string): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: '# ' + id,
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            size: O.none,
            additionalYAMLProps: {},
        },
    }
}

function graphOf(...ids: string[]): Graph {
    return {
        nodes: Object.fromEntries(ids.map((id) => [id, leaf(id)])),
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

function layoutMap(entries: Record<string, NodeLayout>): ReadonlyMap<NodeIdAndFilePath, NodeLayout> {
    return new Map(Object.entries(entries))
}

describe('mergeNodeLayoutIntoGraph', () => {
    it('merges a position-only entry into nodeUIMetadata.position, leaving size None', () => {
        const merged = mergeNodeLayoutIntoGraph(graphOf('a'), layoutMap({ a: { position: { x: 5, y: 6 } } }))
        const meta = merged.nodes['a'].nodeUIMetadata
        expect(meta.position).toEqual(O.some({ x: 5, y: 6 }))
        expect(meta.size ?? O.none).toEqual(O.none)
    })

    it('merges a size-only entry into nodeUIMetadata.size, leaving position None', () => {
        const merged = mergeNodeLayoutIntoGraph(graphOf('a'), layoutMap({ a: { size: { width: 300, height: 200 } } }))
        const meta = merged.nodes['a'].nodeUIMetadata
        expect(meta.size).toEqual(O.some({ width: 300, height: 200 }))
        expect(meta.position).toEqual(O.none)
    })

    it('merges both position and size from a single entry', () => {
        const merged = mergeNodeLayoutIntoGraph(
            graphOf('a'),
            layoutMap({ a: { position: { x: 1, y: 2 }, size: { width: 80, height: 48 } } }),
        )
        const meta = merged.nodes['a'].nodeUIMetadata
        expect(meta.position).toEqual(O.some({ x: 1, y: 2 }))
        expect(meta.size).toEqual(O.some({ width: 80, height: 48 }))
    })

    it('leaves nodes without an entry untouched (same reference)', () => {
        const graph = graphOf('a', 'b')
        const merged = mergeNodeLayoutIntoGraph(graph, layoutMap({ a: { size: { width: 10, height: 10 } } }))
        expect(merged.nodes['b']).toBe(graph.nodes['b'])
        expect(merged.nodes['a'].nodeUIMetadata.size).toEqual(O.some({ width: 10, height: 10 }))
    })

    it('returns the original graph for an empty layout map', () => {
        const graph = graphOf('a')
        const merged = mergeNodeLayoutIntoGraph(graph, new Map())
        expect(merged).toBe(graph)
    })

    it('does not invent a position when only size is provided (and vice versa)', () => {
        // A size entry must not zero-out an existing position, and must not
        // fabricate a position. Start with a node that already has a position.
        const graph = graphOf('a')
        const seeded: Graph = {
            ...graph,
            nodes: {
                a: {
                    ...graph.nodes['a'],
                    nodeUIMetadata: { ...graph.nodes['a'].nodeUIMetadata, position: O.some({ x: 9, y: 9 }) },
                },
            },
        }
        const merged = mergeNodeLayoutIntoGraph(seeded, layoutMap({ a: { size: { width: 5, height: 5 } } }))
        expect(merged.nodes['a'].nodeUIMetadata.position).toEqual(O.some({ x: 9, y: 9 }))
        expect(merged.nodes['a'].nodeUIMetadata.size).toEqual(O.some({ width: 5, height: 5 }))
    })
})
