import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, NodeIdAndFilePath, GraphDelta } from '../..'
import { deleteNodeSimple } from '@vt/graph-model'
import { applyGraphDeltaToGraph } from '../../graphDelta/applyGraphDeltaToGraph'
import { createGraph } from '../../construction/createGraph'

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

/**
 * Helper to apply deleteNodeSimple and return the resulting graph.
 * This mirrors how the function is used in practice.
 */
function deleteAndApply(graph: Graph, nodeIdToRemove: NodeIdAndFilePath): Graph {
    const delta: GraphDelta = deleteNodeSimple(graph, nodeIdToRemove)
    return applyGraphDeltaToGraph(graph, delta)
}

describe('deleteNodeSimple', () => {
    describe('delta structure', () => {
        it('should return a delta with DeleteNode first, followed by UpsertNodes for modified incomers', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'extends' }]),
                'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'implements' }]),
                'c.md': createNode('c.md', [])
            })

            const delta: GraphDelta = deleteNodeSimple(graph, 'b.md')

            expect(delta.length).toBe(2) // DeleteNode for b.md, UpsertNode for a.md
            expect(delta[0].type).toBe('DeleteNode')
            if (delta[0].type === 'DeleteNode') {
                expect(delta[0].nodeId).toBe('b.md')
                expect(O.isSome(delta[0].deletedNode)).toBe(true)
            }
            expect(delta[1].type).toBe('UpsertNode')
            if (delta[1].type === 'UpsertNode') {
                expect(delta[1].nodeToUpsert.absoluteFilePathIsID).toBe('a.md')
            }
        })

        it('should return empty delta if node does not exist', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'test' }]),
                'b.md': createNode('b.md', [])
            })

            const delta: GraphDelta = deleteNodeSimple(graph, 'nonexistent.md')

            expect(delta.length).toBe(0)
        })
    })

    describe('simple chain: a -> b -> c', () => {
        it('should remove middle node and its incoming edges — no transitive edge creation', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'extends' }]),
                'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'implements' }]),
                'c.md': createNode('c.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'b.md')

            expect(result.nodes['b.md']).toBeUndefined()
            // deleteNodeSimple only removes b and cleans up parent edges — no transitive edges
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('multiple children: a -> b -> {c, d}', () => {
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

            const result: Graph = deleteAndApply(graph, 'b.md')

            // a's edge to b is removed, no transitive edges created
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('multiple parents: {a, x} -> b -> c', () => {
        it('should remove node and clean up all parent edges', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'label-a' }]),
                'x.md': createNode('x.md', [{ targetId: 'b.md', label: 'label-x' }]),
                'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                'c.md': createNode('c.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'b.md')

            // Both parents' edges to b are removed, no transitive or cross-incomer edges
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['x.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('edge cases', () => {
        it('should remove edge to deleted node but keep other edges', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [
                    { targetId: 'b.md', label: 'via-b' },
                    { targetId: 'c.md', label: 'direct' }
                ]),
                'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                'c.md': createNode('c.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'b.md')

            // Only the direct edge to c.md remains, the edge to b.md is removed
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['a.md'].outgoingEdges[0].targetId).toBe('c.md')
            expect(result.nodes['a.md'].outgoingEdges[0].label).toBe('direct')
        })

        it('should handle removal of leaf node', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'to-b' }]),
                'b.md': createNode('b.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'b.md')

            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
        })

        it('should handle removal of root node', () => {
            const graph: Graph = createGraph({
                'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                'c.md': createNode('c.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'b.md')

            expect(result.nodes['b.md']).toBeUndefined()
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })

        it('should return unchanged graph if node does not exist', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'test' }]),
                'b.md': createNode('b.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'nonexistent.md')

            expect(result.nodes).toEqual(graph.nodes)
        })
    })

    /**
     * Fan-in pattern tests: Multiple nodes pointing TO the removed node.
     * deleteNodeSimple just removes the node and cleans up parent edges —
     * no transitive or cross-incomer edges are created.
     */
    describe('fan-in pattern: sink node removal ({a, b} -> x, x has no children)', () => {
        it('should remove sink node and clean up parent edges — no cross-incomer edges', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'x.md', label: 'points-to' }]),
                'b.md': createNode('b.md', [{ targetId: 'x.md', label: 'also-points-to' }]),
                'x.md': createNode('x.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'x.md')

            expect(result.nodes['x.md']).toBeUndefined()
            // Parents' edges to x are removed, no new edges created
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['b.md'].outgoingEdges).toHaveLength(0)
        })

        it('should remove sink node with 3+ incomers — all parent edges cleaned up', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'x.md', label: 'label-a' }]),
                'b.md': createNode('b.md', [{ targetId: 'x.md', label: 'label-b' }]),
                'c.md': createNode('c.md', [{ targetId: 'x.md', label: 'label-c' }]),
                'x.md': createNode('x.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'x.md')

            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['b.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })

        it('should only remove edges pointing to deleted node', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'x.md', label: 'my-label' }]),
                'b.md': createNode('b.md', [{ targetId: 'x.md', label: 'other-label' }]),
                'x.md': createNode('x.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'x.md')

            // No new edges created — simple deletion
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['b.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('fan-in with children: {a, b} -> x -> c', () => {
        it('should remove node and clean up parent edges — no transitive or cross-incomer edges', () => {
            const graph: Graph = createGraph({
                'a.md': createNode('a.md', [{ targetId: 'x.md', label: 'label-a' }]),
                'b.md': createNode('b.md', [{ targetId: 'x.md', label: 'label-b' }]),
                'x.md': createNode('x.md', [{ targetId: 'c.md', label: 'to-c' }]),
                'c.md': createNode('c.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'x.md')

            // Parents' edges are cleaned up, no transitive edges to c
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['b.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('simple deletion scenario', () => {
        it('should remove node and clean up all incoming references', () => {
            const graph: Graph = createGraph({
                'original.md': createNode('original.md', [{ targetId: 'context.md', label: 'created' }]),
                'agent_child.md': createNode('agent_child.md', [{ targetId: 'context.md', label: 'parent-backlink' }]),
                'context.md': createNode('context.md', [])
            })

            const result: Graph = deleteAndApply(graph, 'context.md')

            expect(result.nodes['context.md']).toBeUndefined()

            // Both parents' edges to context.md are removed, no new edges
            expect(result.nodes['agent_child.md'].outgoingEdges).toHaveLength(0)
            expect(result.nodes['original.md'].outgoingEdges).toHaveLength(0)
        })
    })
})
