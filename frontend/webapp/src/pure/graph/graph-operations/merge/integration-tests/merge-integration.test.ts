/**
 * Integration test for Merge Selected Nodes feature
 *
 * BEHAVIOR TESTED:
 * - INPUT: Graph with selected nodes to merge + external nodes with incoming edges
 * - OUTPUT: Representative node created, incoming edges redirected, original nodes deleted
 *
 * This tests the integration of:
 * - computeMergeGraphDelta (pure orchestrator)
 * - applyGraphDeltaToGraph (pure delta application)
 * - Full merge flow from selection to graph state
 *
 * Testing Strategy:
 * - Create in-memory graph with nodes and edges
 * - Apply merge delta
 * - Verify resulting graph state
 */

import { describe, it, expect } from 'vitest'
import { computeMergeGraphDelta } from '@/pure/graph/graph-operations/merge/computeMergeGraphDelta'
import { applyGraphDeltaToGraph } from '@/pure/graph'
import type { Graph, GraphNode, Edge, GraphDelta } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

// Helper to create a minimal GraphNode
function createTestNode(
    id: string,
    outgoingEdges: readonly Edge[] = [],
    position?: { x: number; y: number },
    content = '# Node'
): GraphNode {
    return {
        relativeFilePathIsID: id,
        outgoingEdges,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: position ? O.some(position) : O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false
        }
    }
}

// Helper to create an edge
function createEdge(targetId: string, label = ''): Edge {
    return { targetId, label }
}

describe('Merge Selected Nodes - Integration Tests', () => {
    describe('BEHAVIOR: Full merge flow with external incoming edges', () => {
        it('should merge nodes, redirect incoming edges, and delete originals', () => {
            // GIVEN: A graph with:
            // - external1 -> internal1 (incoming edge to be redirected)
            // - external2 -> internal2 (another incoming edge)
            // - internal1 -> internal2 (internal edge to be discarded)
            // - internal2 (leaf node)
            const initialGraph: Graph = {
                nodes: {
                    'external1.md': createTestNode('external1.md', [
                        createEdge('internal1.md', 'references')
                    ], { x: 0, y: 0 }, '# External 1'),
                    'external2.md': createTestNode('external2.md', [
                        createEdge('internal2.md', 'depends on')
                    ], { x: 200, y: 0 }, '# External 2'),
                    'internal1.md': createTestNode('internal1.md', [
                        createEdge('internal2.md', 'child')
                    ], { x: 100, y: 100 }, '# Internal 1'),
                    'internal2.md': createTestNode('internal2.md', [], { x: 100, y: 200 }, '# Internal 2'),
                }
            }

            // WHEN: Merge internal1 and internal2
            const selectedNodeIds: readonly string[] = ['internal1.md', 'internal2.md']
            const delta: GraphDelta = computeMergeGraphDelta(selectedNodeIds, initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: Original nodes should be deleted
            expect(resultGraph.nodes['internal1.md']).toBeUndefined()
            expect(resultGraph.nodes['internal2.md']).toBeUndefined()

            // AND: A new merged node should exist (ID starts with VT/merged_)
            const mergedNodeIds: readonly string[] = Object.keys(resultGraph.nodes).filter(id => id.startsWith('VT/merged_'))
            expect(mergedNodeIds).toHaveLength(1)
            const mergedNodeId: string = mergedNodeIds[0]
            const mergedNode: GraphNode = resultGraph.nodes[mergedNodeId]

            // AND: Merged node should have combined content
            expect(mergedNode.contentWithoutYamlOrLinks).toContain('Merged:')
            expect(mergedNode.contentWithoutYamlOrLinks).toContain('Internal 1')
            expect(mergedNode.contentWithoutYamlOrLinks).toContain('Internal 2')

            // AND: Merged node should have centroid position (100, 150)
            expect(O.isSome(mergedNode.nodeUIMetadata.position)).toBe(true)
            if (O.isSome(mergedNode.nodeUIMetadata.position)) {
                expect(mergedNode.nodeUIMetadata.position.value.x).toBe(100)
                expect(mergedNode.nodeUIMetadata.position.value.y).toBe(150)
            }

            // AND: Merged node should have no outgoing edges (collapsed subgraph)
            expect(mergedNode.outgoingEdges).toHaveLength(0)

            // AND: External nodes should still exist
            expect(resultGraph.nodes['external1.md']).toBeDefined()
            expect(resultGraph.nodes['external2.md']).toBeDefined()

            // AND: external1's edge should now point to merged node
            const ext1Edges: readonly Edge[] = resultGraph.nodes['external1.md'].outgoingEdges
            expect(ext1Edges).toHaveLength(1)
            expect(ext1Edges[0].targetId).toBe(mergedNodeId)
            expect(ext1Edges[0].label).toBe('references')

            // AND: external2's edge should now point to merged node
            const ext2Edges: readonly Edge[] = resultGraph.nodes['external2.md'].outgoingEdges
            expect(ext2Edges).toHaveLength(1)
            expect(ext2Edges[0].targetId).toBe(mergedNodeId)
            expect(ext2Edges[0].label).toBe('depends on')
        })
    })

    describe('BEHAVIOR: Merge isolated subgraph (no external edges)', () => {
        it('should merge nodes without external edges', () => {
            // GIVEN: A graph with isolated nodes (no external edges)
            const initialGraph: Graph = {
                nodes: {
                    'node1.md': createTestNode('node1.md', [
                        createEdge('node2.md', 'link')
                    ], { x: 0, y: 0 }, '# Node 1'),
                    'node2.md': createTestNode('node2.md', [], { x: 100, y: 100 }, '# Node 2'),
                }
            }

            // WHEN: Merge both nodes
            const delta: GraphDelta = computeMergeGraphDelta(['node1.md', 'node2.md'], initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: Only the merged node should remain
            expect(Object.keys(resultGraph.nodes)).toHaveLength(1)
            const mergedNode: GraphNode = Object.values(resultGraph.nodes)[0]
            expect(mergedNode.relativeFilePathIsID).toMatch(/^VT\/merged_/)
        })
    })

    describe('BEHAVIOR: Merge preserves unrelated nodes', () => {
        it('should not affect unrelated nodes in the graph', () => {
            // GIVEN: A graph with some unrelated nodes
            const initialGraph: Graph = {
                nodes: {
                    'unrelated.md': createTestNode('unrelated.md', [
                        createEdge('other-unrelated.md')
                    ], { x: 500, y: 500 }, '# Unrelated'),
                    'other-unrelated.md': createTestNode('other-unrelated.md', [], { x: 600, y: 600 }, '# Other Unrelated'),
                    'to-merge-1.md': createTestNode('to-merge-1.md', [], { x: 0, y: 0 }, '# To Merge 1'),
                    'to-merge-2.md': createTestNode('to-merge-2.md', [], { x: 100, y: 100 }, '# To Merge 2'),
                }
            }

            // WHEN: Merge only to-merge-1 and to-merge-2
            const delta: GraphDelta = computeMergeGraphDelta(['to-merge-1.md', 'to-merge-2.md'], initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: Unrelated nodes should be unchanged
            expect(resultGraph.nodes['unrelated.md']).toBeDefined()
            expect(resultGraph.nodes['other-unrelated.md']).toBeDefined()
            expect(resultGraph.nodes['unrelated.md'].outgoingEdges[0].targetId).toBe('other-unrelated.md')
        })
    })

    describe('BEHAVIOR: Multiple edges from same external node', () => {
        it('should redirect all edges from external node pointing to different subgraph nodes', () => {
            // GIVEN: An external node with edges to multiple nodes in the subgraph
            const initialGraph: Graph = {
                nodes: {
                    'hub.md': createTestNode('hub.md', [
                        createEdge('leaf1.md', 'link1'),
                        createEdge('leaf2.md', 'link2'),
                        createEdge('leaf3.md', 'link3'),
                    ], { x: 0, y: 0 }, '# Hub'),
                    'leaf1.md': createTestNode('leaf1.md', [], { x: 100, y: 0 }, '# Leaf 1'),
                    'leaf2.md': createTestNode('leaf2.md', [], { x: 200, y: 0 }, '# Leaf 2'),
                    'leaf3.md': createTestNode('leaf3.md', [], { x: 300, y: 0 }, '# Leaf 3'),
                }
            }

            // WHEN: Merge all leaf nodes
            const delta: GraphDelta = computeMergeGraphDelta(['leaf1.md', 'leaf2.md', 'leaf3.md'], initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: Hub's edges should all point to the merged node
            const hubEdges: readonly Edge[] = resultGraph.nodes['hub.md'].outgoingEdges
            expect(hubEdges).toHaveLength(3)

            // Find the merged node ID
            const mergedNodeId: string = Object.keys(resultGraph.nodes).find(id => id.startsWith('VT/merged_'))!

            // All edges should point to the same merged node
            expect(hubEdges[0].targetId).toBe(mergedNodeId)
            expect(hubEdges[1].targetId).toBe(mergedNodeId)
            expect(hubEdges[2].targetId).toBe(mergedNodeId)

            // Labels should be preserved
            expect(hubEdges.map(e => e.label).sort()).toEqual(['link1', 'link2', 'link3'])
        })
    })

    describe('BEHAVIOR: Edge cases', () => {
        it('should return empty delta for single node selection', () => {
            const graph: Graph = {
                nodes: {
                    'single.md': createTestNode('single.md')
                }
            }

            const delta: GraphDelta = computeMergeGraphDelta(['single.md'], graph)
            expect(delta).toEqual([])
        })

        it('should return empty delta for empty selection', () => {
            const graph: Graph = {
                nodes: {
                    'node.md': createTestNode('node.md')
                }
            }

            const delta: GraphDelta = computeMergeGraphDelta([], graph)
            expect(delta).toEqual([])
        })

        it('should return empty delta when selected nodes do not exist', () => {
            const graph: Graph = {
                nodes: {
                    'existing.md': createTestNode('existing.md')
                }
            }

            const delta: GraphDelta = computeMergeGraphDelta(['missing1.md', 'missing2.md'], graph)
            expect(delta).toEqual([])
        })
    })
})
