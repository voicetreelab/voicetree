import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, GraphDelta, NodeIdAndFilePath } from '@/pure/graph'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'
import { deleteNodeMaintainingTransitiveEdges } from '@/pure/graph/graph-operations/removeNodeMaintainingTransitiveEdges'

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
        relativeFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${id}`,
        outgoingEdges,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false
        }
    }
}

describe('Edge Preservation on Node Deletion', () => {
    describe('Simple chain: a -> b -> c', () => {
        it('should connect parent to children when middle node is deleted', () => {
            // Setup: a -> b -> c
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'extends' }]),
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'implements' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            // Delete b with edge preservation
            const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Verify: b is deleted
            expect(result.nodes['b.md']).toBeUndefined()

            // Verify: a now points to c with a's original label
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['a.md'].outgoingEdges[0].targetId).toBe('c.md')
            expect(result.nodes['a.md'].outgoingEdges[0].label).toBe('extends') // inherits from parent edge

            // Verify: c is unchanged
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('Multiple children: a -> b -> {c, d}', () => {
        it('should connect parent to all children of deleted node', () => {
            // Setup: a -> b -> c, b -> d
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'parent-of' }]),
                    'b.md': createNode('b.md', [
                        { targetId: 'c.md', label: 'child1' },
                        { targetId: 'd.md', label: 'child2' }
                    ]),
                    'c.md': createNode('c.md', []),
                    'd.md': createNode('d.md', [])
                }
            }

            // Delete b with edge preservation
            const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Verify: a now points to both c and d
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(2)
            const targetIds: readonly NodeIdAndFilePath[] = result.nodes['a.md'].outgoingEdges.map(e => e.targetId)
            expect(targetIds).toContain('c.md')
            expect(targetIds).toContain('d.md')

            // Verify: both edges use parent's label
            expect(result.nodes['a.md'].outgoingEdges.every(e => e.label === 'parent-of')).toBe(true)
        })
    })

    describe('Multiple parents: {a, x} -> b -> c', () => {
        it('should connect all parents to children AND to each other', () => {
            // Setup: a -> b, x -> b, b -> c
            // In bidirectional traversal, a and x can reach each other via b's incoming edges
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'label-a' }]),
                    'x.md': createNode('x.md', [{ targetId: 'b.md', label: 'label-x' }]),
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            // Delete b with edge preservation
            const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Verify: a now points to c (child of b) AND x (fellow incomer)
            expect(result.nodes['a.md'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['c.md', 'x.md'])
            expect(result.nodes['a.md'].outgoingEdges.find(e => e.targetId === 'c.md')?.label).toBe('label-a')
            expect(result.nodes['a.md'].outgoingEdges.find(e => e.targetId === 'x.md')?.label).toBe('label-a')

            // Verify: x now points to c (child of b) AND a (fellow incomer)
            expect(result.nodes['x.md'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['a.md', 'c.md'])
            expect(result.nodes['x.md'].outgoingEdges.find(e => e.targetId === 'c.md')?.label).toBe('label-x')
            expect(result.nodes['x.md'].outgoingEdges.find(e => e.targetId === 'a.md')?.label).toBe('label-x')
        })
    })

    describe('Combined: {a, x} -> b -> {c, d}', () => {
        it('should connect all parents to all children AND to each other', () => {
            // Setup: a -> b, x -> b, b -> c, b -> d
            // In bidirectional traversal, a and x can reach each other via b's incoming edges
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'from-a' }]),
                    'x.md': createNode('x.md', [{ targetId: 'b.md', label: 'from-x' }]),
                    'b.md': createNode('b.md', [
                        { targetId: 'c.md', label: 'to-c' },
                        { targetId: 'd.md', label: 'to-d' }
                    ]),
                    'c.md': createNode('c.md', []),
                    'd.md': createNode('d.md', [])
                }
            }

            // Delete b with edge preservation
            const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Verify: a has edges to c, d (children of b), AND x (fellow incomer)
            expect(result.nodes['a.md'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['c.md', 'd.md', 'x.md'])
            expect(result.nodes['a.md'].outgoingEdges.every(e => e.label === 'from-a')).toBe(true)

            // Verify: x has edges to c, d (children of b), AND a (fellow incomer)
            expect(result.nodes['x.md'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['a.md', 'c.md', 'd.md'])
            expect(result.nodes['x.md'].outgoingEdges.every(e => e.label === 'from-x')).toBe(true)
        })
    })

    describe('Edge cases', () => {
        it('should not create duplicate edges if parent already connects to child', () => {
            // Setup: a -> b -> c, but a also already -> c
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [
                        { targetId: 'b.md', label: 'via-b' },
                        { targetId: 'c.md', label: 'direct' }
                    ]),
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            // Delete b with edge preservation
            const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Verify: a still has only one edge to c (no duplicate)
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['a.md'].outgoingEdges[0].targetId).toBe('c.md')
            // Should keep the existing 'direct' label, not add a new one
            expect(result.nodes['a.md'].outgoingEdges[0].label).toBe('direct')
        })

        it('should handle deletion of node with no children (leaf node)', () => {
            // Setup: a -> b (b has no children)
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'to-b' }]),
                    'b.md': createNode('b.md', [])
                }
            }

            // Delete b with edge preservation
            const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Verify: a's edge to b is removed, no new edges added
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
        })

        it('should handle deletion of node with no parents (root node)', () => {
            // Setup: b -> c (b has no parents)
            const graph: Graph = {
                nodes: {
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            // Delete b with edge preservation
            const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Verify: b is deleted, c is unchanged
            expect(result.nodes['b.md']).toBeUndefined()
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })

        it('should handle deletion when using graph state for edge information', () => {
            // Setup: a -> b -> c
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'extends' }]),
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'implements' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            // Delete b with edge preservation (function reads from graph state)
            const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, 'b.md')
            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Verify: edge preservation still works
            expect(result.nodes['b.md']).toBeUndefined()
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['a.md'].outgoingEdges[0].targetId).toBe('c.md')
        })
    })
})
