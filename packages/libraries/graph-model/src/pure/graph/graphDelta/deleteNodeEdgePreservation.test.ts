import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, GraphDelta, NodeIdAndFilePath } from '..'
import { createGraph } from '../construction/createGraph'
import { applyGraphDeltaToGraph } from './applyGraphDeltaToGraph'
import { deleteNodeSimple } from '@vt/graph-model'

/**
 * TDD Tests for Edge Preservation on Node Deletion
 *
 * When deleting a node, we want to preserve connectivity:
 * If a -> b -> c and we delete b, then a -> c
 *
 * Edge labels inherit from the parent edge (the edge pointing TO the deleted node)
 */

function createNode(id: string, outgoingEdges: readonly { readonly targetId: string; readonly label: string }[] = []): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${id}`,
        outgoingEdges,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
            isContextNode: false
        }
    }
}

describe('Edge Preservation on Node Deletion', () => {
    describe('Simple chain: a -> b -> c', () => {
        it('should remove middle node and clean up parent edges — no transitive edges', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'extends' }]),
                'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'implements' }]),
                'c.md': createNode('c.md', [])
            })

            const delta: GraphDelta = deleteNodeSimple(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            expect(result.nodes['b.md']).toBeUndefined()
            // a's edge to b is removed, no transitive edge to c
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('Multiple children: a -> b -> {c, d}', () => {
        it('should remove node and clean up parent edges — children become disconnected', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'parent-of' }]),
                'b.md': createNode('b.md', [
                    { targetId: 'c.md', label: 'child1' },
                    { targetId: 'd.md', label: 'child2' }
                ]),
                'c.md': createNode('c.md', []),
                'd.md': createNode('d.md', [])
            })

            const delta: GraphDelta = deleteNodeSimple(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // a's edge to b is removed, no transitive edges to c or d
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('Multiple parents: {a, x} -> b -> c', () => {
        it('should remove node and clean up all parent edges', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'label-a' }]),
                'x.md': createNode('x.md', [{ targetId: 'b.md', label: 'label-x' }]),
                'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                'c.md': createNode('c.md', [])
            })

            const delta: GraphDelta = deleteNodeSimple(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Both parents' edges to b are removed, no new edges
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['x.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('Combined: {a, x} -> b -> {c, d}', () => {
        it('should remove node and clean up all parent edges — no transitive or cross-incomer edges', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'from-a' }]),
                'x.md': createNode('x.md', [{ targetId: 'b.md', label: 'from-x' }]),
                'b.md': createNode('b.md', [
                    { targetId: 'c.md', label: 'to-c' },
                    { targetId: 'd.md', label: 'to-d' }
                ]),
                'c.md': createNode('c.md', []),
                'd.md': createNode('d.md', [])
            })

            const delta: GraphDelta = deleteNodeSimple(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Both parents' edges to b are removed, no new edges
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['x.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('Edge cases', () => {
        it('should remove edge to deleted node but keep other edges', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [
                    { targetId: 'b.md', label: 'via-b' },
                    { targetId: 'c.md', label: 'direct' }
                ]),
                'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                'c.md': createNode('c.md', [])
            })

            const delta: GraphDelta = deleteNodeSimple(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Only the direct edge to c remains
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['a.md'].outgoingEdges[0].targetId).toBe('c.md')
            expect(result.nodes['a.md'].outgoingEdges[0].label).toBe('direct')
        })

        it('should handle deletion of node with no children (leaf node)', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'to-b' }]),
                'b.md': createNode('b.md', [])
            })

            const delta: GraphDelta = deleteNodeSimple(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
        })

        it('should handle deletion of node with no parents (root node)', () => {
            const graph: Graph = createGraph({
                'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                'c.md': createNode('c.md', [])
            })

            const delta: GraphDelta = deleteNodeSimple(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            expect(result.nodes['b.md']).toBeUndefined()
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })

        it('should handle deletion using graph state for edge information', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'extends' }]),
                'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'implements' }]),
                'c.md': createNode('c.md', [])
            })

            const delta: GraphDelta = deleteNodeSimple(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            expect(result.nodes['b.md']).toBeUndefined()
            // a's edge to b removed, no transitive edge to c
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
        })
    })
})
