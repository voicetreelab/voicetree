import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Edge, Graph, GraphDelta, GraphNode, NodeIdAndFilePath, UpsertNodeDelta } from '../..'
import { buildIncomingEdgesIndex } from '../../graph-operations/indexes/incomingEdgesIndex'
import { resolveInitialPositionsForDelta } from './resolveInitialPositionsForDelta'

function makeNode(id: string, outgoingEdges: readonly Edge[] = [], position?: { x: number; y: number }): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: id as NodeIdAndFilePath,
        outgoingEdges,
        contentWithoutYamlOrLinks: id,
        nodeUIMetadata: {
            color: O.none,
            position: position ? O.some(position) : O.none,
            additionalYAMLProps: {},
            isContextNode: false,
        },
    }
}

function makeGraph(nodes: Record<string, GraphNode>): Graph {
    return {
        nodes: nodes as Record<NodeIdAndFilePath, GraphNode>,
        incomingEdgesIndex: buildIncomingEdgesIndex(nodes as Record<NodeIdAndFilePath, GraphNode>),
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

function upsert(node: GraphNode, previousNode: O.Option<GraphNode> = O.none): UpsertNodeDelta {
    return { type: 'UpsertNode', nodeToUpsert: node, previousNode }
}

describe('resolveInitialPositionsForDelta', () => {
    it('fills in position for a new node by following its parent edge', () => {
        const graph: Graph = makeGraph({
            '/project/parent.md': makeNode('/project/parent.md', [], { x: 100, y: 200 }),
        })
        const child: GraphNode = makeNode('/project/child.md', [
            { targetId: '/project/parent.md' as NodeIdAndFilePath, label: 'parent' },
        ])

        const { delta, anyResolved } = resolveInitialPositionsForDelta(graph, [upsert(child)])

        expect(anyResolved).toBe(true)
        const resolvedChild: UpsertNodeDelta = delta[0] as UpsertNodeDelta
        expect(O.isSome(resolvedChild.nodeToUpsert.nodeUIMetadata.position)).toBe(true)
    })

    it('preserves existing position on new node (legacy YAML)', () => {
        const graph: Graph = makeGraph({
            '/project/parent.md': makeNode('/project/parent.md', [], { x: 100, y: 200 }),
        })
        const child: GraphNode = makeNode(
            '/project/child.md',
            [{ targetId: '/project/parent.md' as NodeIdAndFilePath, label: 'parent' }],
            { x: 999, y: 999 },
        )

        const { delta, anyResolved } = resolveInitialPositionsForDelta(graph, [upsert(child)])

        expect(anyResolved).toBe(false)
        const resolvedChild: UpsertNodeDelta = delta[0] as UpsertNodeDelta
        const position: O.Option<{ x: number; y: number }> = resolvedChild.nodeToUpsert.nodeUIMetadata.position
        expect(O.isSome(position)).toBe(true)
        if (O.isSome(position)) expect(position.value).toEqual({ x: 999, y: 999 })
    })

    it('skips updates to existing nodes (previousNode = Some)', () => {
        const existing: GraphNode = makeNode('/project/n.md', [], { x: 1, y: 2 })
        const graph: Graph = makeGraph({ '/project/n.md': existing })
        const updated: GraphNode = makeNode('/project/n.md', [])

        const { delta, anyResolved } = resolveInitialPositionsForDelta(graph, [upsert(updated, O.some(existing))])

        expect(anyResolved).toBe(false)
        expect(delta[0]).toBe(delta[0])
        const out: UpsertNodeDelta = delta[0] as UpsertNodeDelta
        expect(O.isNone(out.nodeToUpsert.nodeUIMetadata.position)).toBe(true)
    })

    it('returns the original delta reference when no resolution needed', () => {
        const graph: Graph = makeGraph({})
        const delta: GraphDelta = []
        const result = resolveInitialPositionsForDelta(graph, delta)
        expect(result.delta).toBe(delta)
        expect(result.anyResolved).toBe(false)
    })

    it('resolves a batch where later nodes depend on earlier nodes in the same delta', () => {
        const graph: Graph = makeGraph({
            '/project/root.md': makeNode('/project/root.md', [], { x: 0, y: 0 }),
        })
        const mid: GraphNode = makeNode('/project/mid.md', [
            { targetId: '/project/root.md' as NodeIdAndFilePath, label: 'parent' },
        ])
        const leaf: GraphNode = makeNode('/project/leaf.md', [
            { targetId: '/project/mid.md' as NodeIdAndFilePath, label: 'parent' },
        ])

        const { delta, anyResolved } = resolveInitialPositionsForDelta(graph, [upsert(mid), upsert(leaf)])

        expect(anyResolved).toBe(true)
        const midOut: UpsertNodeDelta = delta[0] as UpsertNodeDelta
        const leafOut: UpsertNodeDelta = delta[1] as UpsertNodeDelta
        expect(O.isSome(midOut.nodeToUpsert.nodeUIMetadata.position)).toBe(true)
        // leaf can only be positioned if mid was first positioned in the same pass.
        expect(O.isSome(leafOut.nodeToUpsert.nodeUIMetadata.position)).toBe(true)
    })

    it('falls back to centroid free-slot for a parentless new node', () => {
        const graph: Graph = makeGraph({
            '/project/a.md': makeNode('/project/a.md', [], { x: 50, y: 50 }),
        })
        const orphan: GraphNode = makeNode('/project/orphan.md', [])

        const { delta, anyResolved } = resolveInitialPositionsForDelta(graph, [upsert(orphan)])

        expect(anyResolved).toBe(true)
        const out: UpsertNodeDelta = delta[0] as UpsertNodeDelta
        expect(O.isSome(out.nodeToUpsert.nodeUIMetadata.position)).toBe(true)
    })
})
