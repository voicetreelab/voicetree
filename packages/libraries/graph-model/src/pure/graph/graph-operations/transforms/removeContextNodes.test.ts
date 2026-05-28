import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode } from '../..'
import { createGraph } from '../../construction/createGraph'
import { removeContextNodes } from './removeContextNodes'

function createNode(id: string, edges: readonly string[] = []): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${id}`,
        outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
            isContextNode: false
        }
    }
}

function createContextNode(id: string, edges: readonly string[] = []): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${id}`,
        outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
            isContextNode: true
        }
    }
}

function toEdges(ids: readonly string[]): readonly { readonly targetId: string; readonly label: string }[] {
    return ids.map(targetId => ({ targetId, label: '' }))
}

describe('removeContextNodes', () => {
    it('should remove context node and clean up parent edges — no bridging', () => {
        // A -> ContextNode -> B: ContextNode removed, A loses its edge (no transitive edge to B)
        const graph: Graph = createGraph({
            'A': createNode('A', ['ContextNode']),
            'ContextNode': createContextNode('ContextNode', ['B']),
            'B': createNode('B', [])
        })

        const result: Graph = removeContextNodes(graph)

        expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
        expect(result.nodes['A'].outgoingEdges).toEqual([])
    })

    it('should handle chained context nodes', () => {
        // A -> Ctx1 -> Ctx2 -> B: both context nodes removed, A loses its edge
        const graph: Graph = createGraph({
            'A': createNode('A', ['Ctx1']),
            'Ctx1': createContextNode('Ctx1', ['Ctx2']),
            'Ctx2': createContextNode('Ctx2', ['B']),
            'B': createNode('B', [])
        })

        const result: Graph = removeContextNodes(graph)

        expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
        expect(result.nodes['A'].outgoingEdges).toEqual([])
    })

    it('should handle context node with multiple children', () => {
        // A -> ContextNode -> {B, C, D}: ContextNode removed, A loses its edge
        const graph: Graph = createGraph({
            'A': createNode('A', ['ContextNode']),
            'ContextNode': createContextNode('ContextNode', ['B', 'C', 'D']),
            'B': createNode('B', []),
            'C': createNode('C', []),
            'D': createNode('D', [])
        })

        const result: Graph = removeContextNodes(graph)

        expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
        expect(result.nodes['A'].outgoingEdges).toEqual([])
    })

    it('should handle graph with no context nodes', () => {
        // A -> B -> C (no context nodes, unchanged)
        const graph: Graph = createGraph({
            'A': createNode('A', ['B']),
            'B': createNode('B', ['C']),
            'C': createNode('C', [])
        })

        const result: Graph = removeContextNodes(graph)

        expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
        expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
        expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['C']))
    })

    it('should handle context node with no parents (orphan context subtree)', () => {
        // Ctx1 -> Ctx2 -> A  becomes  A (with no edges)
        const graph: Graph = createGraph({
            'Ctx1': createContextNode('Ctx1', ['Ctx2']),
            'Ctx2': createContextNode('Ctx2', ['A']),
            'A': createNode('A', ['B']),
            'B': createNode('B', [])
        })

        const result: Graph = removeContextNodes(graph)

        expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
        expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should handle alternating context and regular nodes', () => {
        // A -> Ctx1 -> B -> Ctx2 -> C: context nodes removed, parent edges cleaned up
        const graph: Graph = createGraph({
            'A': createNode('A', ['Ctx1']),
            'Ctx1': createContextNode('Ctx1', ['B']),
            'B': createNode('B', ['Ctx2']),
            'Ctx2': createContextNode('Ctx2', ['C']),
            'C': createNode('C', [])
        })

        const result: Graph = removeContextNodes(graph)

        expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
        // A's edge to Ctx1 removed, B's edge to Ctx2 removed — no bridging
        expect(result.nodes['A'].outgoingEdges).toEqual([])
        expect(result.nodes['B'].outgoingEdges).toEqual([])
    })

    it('should handle diamond topology with context node in one path', () => {
        // A -> ContextNode -> C
        // A -> B -> C
        // ContextNode removed, A keeps only its edge to B
        const graph: Graph = createGraph({
            'A': createNode('A', ['ContextNode', 'B']),
            'ContextNode': createContextNode('ContextNode', ['C']),
            'B': createNode('B', ['C']),
            'C': createNode('C', [])
        })

        const result: Graph = removeContextNodes(graph)

        expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
        // A's edge to ContextNode removed, but edge to B remains
        expect(result.nodes['A'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['B'])
        expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['C']))
    })

    it('should handle graph with only context nodes', () => {
        const graph: Graph = createGraph({
            'Ctx1': createContextNode('Ctx1', ['Ctx2']),
            'Ctx2': createContextNode('Ctx2', [])
        })

        const result: Graph = removeContextNodes(graph)

        expect(Object.keys(result.nodes)).toEqual([])
    })

    it('should handle empty graph', () => {
        const graph: Graph = createGraph({})

        const result: Graph = removeContextNodes(graph)

        expect(result.nodes).toEqual({})
    })

    it('should remove context node and clean up parent edges (star pattern)', () => {
        // A -> ContextNode <- C: ContextNode removed, both parents lose their edges
        const graph: Graph = createGraph({
            'A': createNode('A', ['ContextNode']),
            'ContextNode': createContextNode('ContextNode', []),
            'C': createNode('C', ['ContextNode'])
        })

        const result: Graph = removeContextNodes(graph)

        // Both nodes should remain
        expect(Object.keys(result.nodes).sort()).toEqual(['A', 'C'])

        // No cross-incomer edges — simple deletion only removes parent edges
        expect(result.nodes['A'].outgoingEdges).toHaveLength(0)
        expect(result.nodes['C'].outgoingEdges).toHaveLength(0)
    })
})
