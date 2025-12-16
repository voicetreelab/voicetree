import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode, NodeIdAndFilePath, GraphDelta } from '@/pure/graph'
import { deleteNodeMaintainingTransitiveEdges } from './removeNodeMaintainingTransitiveEdges'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'

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

/**
 * Helper to apply deleteNodeMaintainingTransitiveEdges and return the resulting graph.
 * This mirrors how the function is used in practice.
 */
function deleteAndApply(graph: Graph, nodeIdToRemove: NodeIdAndFilePath): Graph {
    const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, nodeIdToRemove)
    return applyGraphDeltaToGraph(graph, delta)
}

describe('deleteNodeMaintainingTransitiveEdges', () => {
    describe('delta structure', () => {
        it('should return a delta with DeleteNode first, followed by UpsertNodes for modified incomers', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'extends' }]),
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'implements' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, 'b.md')

            expect(delta.length).toBe(2) // DeleteNode for b.md, UpsertNode for a.md
            expect(delta[0].type).toBe('DeleteNode')
            if (delta[0].type === 'DeleteNode') {
                expect(delta[0].nodeId).toBe('b.md')
                expect(O.isSome(delta[0].deletedNode)).toBe(true)
            }
            expect(delta[1].type).toBe('UpsertNode')
            if (delta[1].type === 'UpsertNode') {
                expect(delta[1].nodeToUpsert.relativeFilePathIsID).toBe('a.md')
            }
        })

        it('should return empty delta if node does not exist', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'test' }]),
                    'b.md': createNode('b.md', [])
                }
            }

            const delta: GraphDelta = deleteNodeMaintainingTransitiveEdges(graph, 'nonexistent.md')

            expect(delta.length).toBe(0)
        })
    })

    describe('simple chain: a -> b -> c', () => {
        it('should connect parent to children when middle node is removed', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'extends' }]),
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'implements' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            const result: Graph = deleteAndApply(graph, 'b.md')

            expect(result.nodes['b.md']).toBeUndefined()
            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['a.md'].outgoingEdges[0].targetId).toBe('c.md')
            expect(result.nodes['a.md'].outgoingEdges[0].label).toBe('extends')
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })
    })

    describe('multiple children: a -> b -> {c, d}', () => {
        it('should connect parent to all children of removed node', () => {
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

            const result: Graph = deleteAndApply(graph, 'b.md')

            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(2)
            const targetIds: readonly NodeIdAndFilePath[] = result.nodes['a.md'].outgoingEdges.map(e => e.targetId)
            expect(targetIds).toContain('c.md')
            expect(targetIds).toContain('d.md')
            expect(result.nodes['a.md'].outgoingEdges.every(e => e.label === 'parent-of')).toBe(true)
        })
    })

    describe('multiple parents: {a, x} -> b -> c', () => {
        it('should connect all parents to children AND to each other', () => {
            // In bidirectional traversal, a and x can reach each other via b's incoming edges
            // So when removing b, we preserve: a -> c, x -> c (children) AND a -> x, x -> a (incomers)
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'label-a' }]),
                    'x.md': createNode('x.md', [{ targetId: 'b.md', label: 'label-x' }]),
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            const result: Graph = deleteAndApply(graph, 'b.md')

            // a connects to c (child of b) and x (other incomer)
            const aTargets: readonly string[] = result.nodes['a.md'].outgoingEdges.map(e => e.targetId)
            expect(aTargets).toContain('c.md')
            expect(aTargets).toContain('x.md')
            expect(result.nodes['a.md'].outgoingEdges.find(e => e.targetId === 'c.md')?.label).toBe('label-a')
            expect(result.nodes['a.md'].outgoingEdges.find(e => e.targetId === 'x.md')?.label).toBe('label-a')

            // x connects to c (child of b) and a (other incomer)
            const xTargets: readonly string[] = result.nodes['x.md'].outgoingEdges.map(e => e.targetId)
            expect(xTargets).toContain('c.md')
            expect(xTargets).toContain('a.md')
            expect(result.nodes['x.md'].outgoingEdges.find(e => e.targetId === 'c.md')?.label).toBe('label-x')
            expect(result.nodes['x.md'].outgoingEdges.find(e => e.targetId === 'a.md')?.label).toBe('label-x')
        })
    })

    describe('edge cases', () => {
        it('should not create duplicate edges if parent already connects to child', () => {
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

            const result: Graph = deleteAndApply(graph, 'b.md')

            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(1)
            expect(result.nodes['a.md'].outgoingEdges[0].targetId).toBe('c.md')
            expect(result.nodes['a.md'].outgoingEdges[0].label).toBe('direct')
        })

        it('should handle removal of leaf node', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'to-b' }]),
                    'b.md': createNode('b.md', [])
                }
            }

            const result: Graph = deleteAndApply(graph, 'b.md')

            expect(result.nodes['a.md'].outgoingEdges).toHaveLength(0)
        })

        it('should handle removal of root node', () => {
            const graph: Graph = {
                nodes: {
                    'b.md': createNode('b.md', [{ targetId: 'c.md', label: 'to-c' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            const result: Graph = deleteAndApply(graph, 'b.md')

            expect(result.nodes['b.md']).toBeUndefined()
            expect(result.nodes['c.md'].outgoingEdges).toHaveLength(0)
        })

        it('should return unchanged graph if node does not exist', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'b.md', label: 'test' }]),
                    'b.md': createNode('b.md', [])
                }
            }

            const result: Graph = deleteAndApply(graph, 'nonexistent.md')

            expect(result.nodes).toEqual(graph.nodes)
        })
    })

    /**
     * Fan-in pattern tests: Multiple nodes pointing TO the removed node.
     *
     * In bidirectional traversal (like getSubgraphByDistance), when at node X,
     * we can follow X's "incoming" edges to find other nodes pointing to X.
     * This means nodes A and B that both point to X can reach each other via X.
     *
     * When X is removed, we must preserve this reachability by connecting
     * the incomers to each other.
     */
    describe('fan-in pattern: sink node removal ({a, b} -> x, x has no children)', () => {
        it('should connect incomers to each other when removing a sink node', () => {
            // Before: a -> x, b -> x (x is a "sink" with no outgoing edges)
            // Bidirectional traversal: a can reach b via x's incoming edges
            // After removing x: a -> b, b -> a (preserve mutual reachability)
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'x.md', label: 'points-to' }]),
                    'b.md': createNode('b.md', [{ targetId: 'x.md', label: 'also-points-to' }]),
                    'x.md': createNode('x.md', []) // sink node - no outgoing edges
                }
            }

            const result: Graph = deleteAndApply(graph, 'x.md')

            expect(result.nodes['x.md']).toBeUndefined()
            // a should connect to b (preserves: a -> x -> incoming -> b)
            expect(result.nodes['a.md'].outgoingEdges.map(e => e.targetId)).toContain('b.md')
            // b should connect to a (preserves: b -> x -> incoming -> a)
            expect(result.nodes['b.md'].outgoingEdges.map(e => e.targetId)).toContain('a.md')
        })

        it('should connect all incomers to each other with 3+ nodes', () => {
            // a -> x, b -> x, c -> x (all can reach each other via x)
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'x.md', label: 'label-a' }]),
                    'b.md': createNode('b.md', [{ targetId: 'x.md', label: 'label-b' }]),
                    'c.md': createNode('c.md', [{ targetId: 'x.md', label: 'label-c' }]),
                    'x.md': createNode('x.md', [])
                }
            }

            const result: Graph = deleteAndApply(graph, 'x.md')

            // Each incomer should be able to reach the others
            const aTargets: readonly string[] = result.nodes['a.md'].outgoingEdges.map(e => e.targetId)
            const bTargets: readonly string[] = result.nodes['b.md'].outgoingEdges.map(e => e.targetId)
            const cTargets: readonly string[] = result.nodes['c.md'].outgoingEdges.map(e => e.targetId)

            expect(aTargets).toContain('b.md')
            expect(aTargets).toContain('c.md')
            expect(bTargets).toContain('a.md')
            expect(bTargets).toContain('c.md')
            expect(cTargets).toContain('a.md')
            expect(cTargets).toContain('b.md')
        })

        it('should preserve original labels when connecting incomers', () => {
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'x.md', label: 'my-label' }]),
                    'b.md': createNode('b.md', [{ targetId: 'x.md', label: 'other-label' }]),
                    'x.md': createNode('x.md', [])
                }
            }

            const result: Graph = deleteAndApply(graph, 'x.md')

            // a's new edge to b should use a's original label
            const aToB = result.nodes['a.md'].outgoingEdges.find(e => e.targetId === 'b.md')
            expect(aToB?.label).toBe('my-label')

            // b's new edge to a should use b's original label
            const bToA = result.nodes['b.md'].outgoingEdges.find(e => e.targetId === 'a.md')
            expect(bToA?.label).toBe('other-label')
        })
    })

    describe('fan-in with children: {a, b} -> x -> c', () => {
        it('should connect incomers to children AND to each other', () => {
            // Before: a -> x -> c, b -> x
            // After: a -> c, b -> c (current), PLUS a -> b, b -> a (new)
            const graph: Graph = {
                nodes: {
                    'a.md': createNode('a.md', [{ targetId: 'x.md', label: 'label-a' }]),
                    'b.md': createNode('b.md', [{ targetId: 'x.md', label: 'label-b' }]),
                    'x.md': createNode('x.md', [{ targetId: 'c.md', label: 'to-c' }]),
                    'c.md': createNode('c.md', [])
                }
            }

            const result: Graph = deleteAndApply(graph, 'x.md')

            // Current behavior: incomers connect to children
            expect(result.nodes['a.md'].outgoingEdges.map(e => e.targetId)).toContain('c.md')
            expect(result.nodes['b.md'].outgoingEdges.map(e => e.targetId)).toContain('c.md')

            // New behavior: incomers connect to each other
            expect(result.nodes['a.md'].outgoingEdges.map(e => e.targetId)).toContain('b.md')
            expect(result.nodes['b.md'].outgoingEdges.map(e => e.targetId)).toContain('a.md')
        })
    })

    describe('context node bug scenario', () => {
        it('should preserve reachability when removing context node with backlink pattern', () => {
            // Real bug scenario:
            // original_node -> context_node (original created context)
            // agent_child -> context_node (agent added backlink to "parent")
            // context_node has no outgoing edges
            //
            // When traversing from agent_child:
            // - Go to context_node (outgoing)
            // - See original_node via context_node's incoming
            //
            // After removing context_node, agent_child should reach original_node
            const graph: Graph = {
                nodes: {
                    'original.md': createNode('original.md', [{ targetId: 'context.md', label: 'created' }]),
                    'agent_child.md': createNode('agent_child.md', [{ targetId: 'context.md', label: 'parent-backlink' }]),
                    'context.md': createNode('context.md', []) // Context node - no outgoing
                }
            }

            const result: Graph = deleteAndApply(graph, 'context.md')

            expect(result.nodes['context.md']).toBeUndefined()

            // agent_child should be able to reach original (was reachable via context's incoming)
            expect(result.nodes['agent_child.md'].outgoingEdges.map(e => e.targetId)).toContain('original.md')

            // original should be able to reach agent_child
            expect(result.nodes['original.md'].outgoingEdges.map(e => e.targetId)).toContain('agent_child.md')
        })
    })
})
