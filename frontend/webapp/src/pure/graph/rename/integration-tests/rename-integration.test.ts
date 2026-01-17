/**
 * Integration test for Rename Node feature (Phase 3)
 *
 * BEHAVIOR TESTED:
 * - INPUT: Graph with node to rename + nodes with incoming edges
 * - OUTPUT: Node ID changed, incoming edges redirected, content placeholders updated
 *
 * This tests the integration of:
 * - computeRenameNodeDelta (pure delta computation)
 * - applyGraphDeltaToGraph (pure delta application)
 * - Full rename flow from old ID to new ID
 *
 * Testing Strategy:
 * - Create in-memory graph with nodes and edges
 * - Compute rename delta
 * - Apply delta to graph
 * - Verify resulting graph state
 */

import { describe, it, expect } from 'vitest'
import { computeRenameNodeDelta } from '@/pure/graph/rename/computeRenameNodeDelta'
import { applyGraphDeltaToGraph } from '@/pure/graph'
import type { Graph, GraphNode, Edge, GraphDelta, NodeIdAndFilePath } from '@/pure/graph'
import { createGraph } from '@/pure/graph/createGraph'
import * as O from 'fp-ts/lib/Option.js'

// Helper to create a minimal GraphNode
function createTestNode(
    id: NodeIdAndFilePath,
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
function createEdge(targetId: NodeIdAndFilePath, label = ''): Edge {
    return { targetId, label }
}

describe('Rename Node - Integration Tests', () => {
    describe('BEHAVIOR: Full rename flow with incoming edges', () => {
        it('should rename node, redirect incoming edges, and update content placeholders', () => {
            // GIVEN: A graph with:
            // - source1 -> target (incoming edge to be redirected)
            // - source2 -> target (another incoming edge)
            // - target (node to be renamed)
            const oldId: NodeIdAndFilePath = 'folder/old_title.md'
            const newId: NodeIdAndFilePath = 'folder/new_title.md'

            const initialGraph: Graph = createGraph({
                'folder/source1.md': createTestNode(
                    'folder/source1.md',
                    [createEdge(oldId, 'references')],
                    { x: 0, y: 0 },
                    '# Source 1\n\nLinks to [old_title]*'
                ),
                'folder/source2.md': createTestNode(
                    'folder/source2.md',
                    [createEdge(oldId, 'depends on')],
                    { x: 200, y: 0 },
                    '# Source 2\n\nAlso links to [old_title]*'
                ),
                [oldId]: createTestNode(
                    oldId,
                    [],
                    { x: 100, y: 100 },
                    '# Old Title\n\nSome content here'
                )
            })

            // WHEN: Rename target node
            const delta: GraphDelta = computeRenameNodeDelta(oldId, newId, initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: Old node should still exist (applyGraphDeltaToGraph does NOT implement rename detection)
            expect(resultGraph.nodes[oldId]).toBeDefined()
            expect(resultGraph.nodes[oldId].contentWithoutYamlOrLinks).toBe('# Old Title\n\nSome content here')

            // AND: New node should exist with same content
            expect(resultGraph.nodes[newId]).toBeDefined()
            expect(resultGraph.nodes[newId].contentWithoutYamlOrLinks).toBe('# Old Title\n\nSome content here')

            // AND: Position should be preserved
            expect(O.isSome(resultGraph.nodes[newId].nodeUIMetadata.position)).toBe(true)
            if (O.isSome(resultGraph.nodes[newId].nodeUIMetadata.position)) {
                expect(resultGraph.nodes[newId].nodeUIMetadata.position.value).toEqual({ x: 100, y: 100 })
            }

            // AND: source1's edge should now point to new ID
            const source1Edges: readonly Edge[] = resultGraph.nodes['folder/source1.md'].outgoingEdges
            expect(source1Edges).toHaveLength(1)
            expect(source1Edges[0].targetId).toBe(newId)
            expect(source1Edges[0].label).toBe('references')

            // AND: source1's content placeholder should be updated
            expect(resultGraph.nodes['folder/source1.md'].contentWithoutYamlOrLinks).toBe(
                '# Source 1\n\nLinks to [new_title]*'
            )

            // AND: source2's edge should now point to new ID
            const source2Edges: readonly Edge[] = resultGraph.nodes['folder/source2.md'].outgoingEdges
            expect(source2Edges).toHaveLength(1)
            expect(source2Edges[0].targetId).toBe(newId)
            expect(source2Edges[0].label).toBe('depends on')

            // AND: source2's content placeholder should be updated
            expect(resultGraph.nodes['folder/source2.md'].contentWithoutYamlOrLinks).toBe(
                '# Source 2\n\nAlso links to [new_title]*'
            )
        })
    })

    describe('BEHAVIOR: Rename isolated node (no incoming edges)', () => {
        it('should rename node without affecting other nodes', () => {
            // GIVEN: A graph with isolated nodes
            const oldId: NodeIdAndFilePath = 'folder/isolated.md'
            const newId: NodeIdAndFilePath = 'folder/renamed.md'

            const initialGraph: Graph = createGraph({
                [oldId]: createTestNode(oldId, [], { x: 50, y: 50 }, '# Isolated'),
                'folder/unrelated.md': createTestNode(
                    'folder/unrelated.md',
                    [createEdge('folder/other.md')],
                    { x: 200, y: 200 },
                    '# Unrelated'
                ),
                'folder/other.md': createTestNode('folder/other.md', [], undefined, '# Other')
            })

            // WHEN: Rename isolated node
            const delta: GraphDelta = computeRenameNodeDelta(oldId, newId, initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: Old node should still exist (applyGraphDeltaToGraph does NOT implement rename detection)
            expect(resultGraph.nodes[oldId]).toBeDefined()
            expect(resultGraph.nodes[oldId].contentWithoutYamlOrLinks).toBe('# Isolated')

            // AND: New node should exist with same content
            expect(resultGraph.nodes[newId]).toBeDefined()
            expect(resultGraph.nodes[newId].contentWithoutYamlOrLinks).toBe('# Isolated')

            // AND: Unrelated nodes should be unchanged
            expect(resultGraph.nodes['folder/unrelated.md']).toBeDefined()
            expect(resultGraph.nodes['folder/unrelated.md'].outgoingEdges[0].targetId).toBe('folder/other.md')
            expect(resultGraph.nodes['folder/other.md']).toBeDefined()
        })
    })

    describe('BEHAVIOR: Rename preserves outgoing edges', () => {
        it('should preserve outgoing edges from renamed node', () => {
            // GIVEN: A node with outgoing edges
            const oldId: NodeIdAndFilePath = 'folder/hub.md'
            const newId: NodeIdAndFilePath = 'folder/renamed_hub.md'

            const initialGraph: Graph = createGraph({
                [oldId]: createTestNode(
                    oldId,
                    [
                        createEdge('folder/child1.md', 'has'),
                        createEdge('folder/child2.md', 'contains')
                    ],
                    { x: 0, y: 0 },
                    '# Hub\n\nLinks to [child1]* and [child2]*'
                ),
                'folder/child1.md': createTestNode('folder/child1.md', [], undefined, '# Child 1'),
                'folder/child2.md': createTestNode('folder/child2.md', [], undefined, '# Child 2')
            })

            // WHEN: Rename hub node
            const delta: GraphDelta = computeRenameNodeDelta(oldId, newId, initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: Outgoing edges should be preserved
            const renamedNode: GraphNode = resultGraph.nodes[newId]
            expect(renamedNode.outgoingEdges).toHaveLength(2)
            expect(renamedNode.outgoingEdges[0].targetId).toBe('folder/child1.md')
            expect(renamedNode.outgoingEdges[0].label).toBe('has')
            expect(renamedNode.outgoingEdges[1].targetId).toBe('folder/child2.md')
            expect(renamedNode.outgoingEdges[1].label).toBe('contains')
        })
    })

    describe('BEHAVIOR: Multiple edges from same source node', () => {
        it('should redirect all edges from a node pointing to the renamed node', () => {
            // GIVEN: A source node with multiple edges to the same target
            const oldId: NodeIdAndFilePath = 'folder/target.md'
            const newId: NodeIdAndFilePath = 'folder/renamed_target.md'

            const initialGraph: Graph = createGraph({
                'folder/source.md': createTestNode(
                    'folder/source.md',
                    [
                        createEdge(oldId, 'rel1'),
                        createEdge(oldId, 'rel2'),
                        createEdge('folder/other.md', 'unrelated')
                    ],
                    undefined,
                    '# Source\n\nFirst [target]* and second [target]* and [other]*'
                ),
                [oldId]: createTestNode(oldId, [], undefined, '# Target'),
                'folder/other.md': createTestNode('folder/other.md', [], undefined, '# Other')
            })

            // WHEN: Rename target
            const delta: GraphDelta = computeRenameNodeDelta(oldId, newId, initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: Both edges to target should be redirected
            const sourceEdges: readonly Edge[] = resultGraph.nodes['folder/source.md'].outgoingEdges
            expect(sourceEdges).toHaveLength(3)

            const edgesToRenamed: readonly Edge[] = sourceEdges.filter(e => e.targetId === newId)
            expect(edgesToRenamed).toHaveLength(2)
            expect(edgesToRenamed.map(e => e.label).sort()).toEqual(['rel1', 'rel2'])

            // AND: Edge to other should be unchanged
            const edgesToOther: readonly Edge[] = sourceEdges.filter(e => e.targetId === 'folder/other.md')
            expect(edgesToOther).toHaveLength(1)

            // AND: Content placeholders should be updated (both occurrences)
            expect(resultGraph.nodes['folder/source.md'].contentWithoutYamlOrLinks).toBe(
                '# Source\n\nFirst [renamed_target]* and second [renamed_target]* and [other]*'
            )
        })
    })

    describe('BEHAVIOR: Rename across folders', () => {
        it('should handle rename that changes folder path', () => {
            // GIVEN: A node in one folder with incoming edges from another folder
            const oldId: NodeIdAndFilePath = 'folder_a/old_name.md'
            const newId: NodeIdAndFilePath = 'folder_b/new_name.md'

            const initialGraph: Graph = createGraph({
                'folder_c/source.md': createTestNode(
                    'folder_c/source.md',
                    [createEdge(oldId)],
                    undefined,
                    '# Source\n\nLinks to [folder_a/old_name]*'
                ),
                [oldId]: createTestNode(oldId, [], { x: 100, y: 100 }, '# Old Name')
            })

            // WHEN: Rename to different folder
            const delta: GraphDelta = computeRenameNodeDelta(oldId, newId, initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: Old node should still exist (applyGraphDeltaToGraph does NOT implement rename detection)
            expect(resultGraph.nodes[oldId]).toBeDefined()
            expect(resultGraph.nodes[oldId].contentWithoutYamlOrLinks).toBe('# Old Name')

            // AND: New node should exist at new path
            expect(resultGraph.nodes[newId]).toBeDefined()
            expect(resultGraph.nodes[newId].contentWithoutYamlOrLinks).toBe('# Old Name')

            // AND: Incoming edge should point to new path
            expect(resultGraph.nodes['folder_c/source.md'].outgoingEdges[0].targetId).toBe(newId)

            // AND: Content placeholder should use new basename
            expect(resultGraph.nodes['folder_c/source.md'].contentWithoutYamlOrLinks).toBe(
                '# Source\n\nLinks to [new_name]*'
            )
        })
    })

    describe('BEHAVIOR: Rename preserves metadata', () => {
        it('should preserve color and other UI metadata during rename', () => {
            const oldId: NodeIdAndFilePath = 'folder/colored.md'
            const newId: NodeIdAndFilePath = 'folder/renamed_colored.md'

            const initialGraph: Graph = createGraph({
                [oldId]: {
                    relativeFilePathIsID: oldId,
                    outgoingEdges: [],
                    contentWithoutYamlOrLinks: '# Colored Node',
                    nodeUIMetadata: {
                        color: O.some('#ff5500'),
                        position: O.some({ x: 42, y: 84 }),
                        additionalYAMLProps: new Map([['agent_name', 'TestAgent']]),
                        isContextNode: false
                    }
                }
            })

            // WHEN: Rename
            const delta: GraphDelta = computeRenameNodeDelta(oldId, newId, initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: All metadata should be preserved
            const renamedNode: GraphNode = resultGraph.nodes[newId]
            expect(O.isSome(renamedNode.nodeUIMetadata.color)).toBe(true)
            if (O.isSome(renamedNode.nodeUIMetadata.color)) {
                expect(renamedNode.nodeUIMetadata.color.value).toBe('#ff5500')
            }
            expect(O.isSome(renamedNode.nodeUIMetadata.position)).toBe(true)
            if (O.isSome(renamedNode.nodeUIMetadata.position)) {
                expect(renamedNode.nodeUIMetadata.position.value).toEqual({ x: 42, y: 84 })
            }
        })
    })

    describe('BEHAVIOR: Edge cases', () => {
        it('should return empty delta for non-existent node', () => {
            const graph: Graph = createGraph({
                'folder/exists.md': createTestNode('folder/exists.md')
            })

            const delta: GraphDelta = computeRenameNodeDelta(
                'folder/missing.md',
                'folder/new.md',
                graph
            )
            expect(delta).toEqual([])
        })

        it('should handle rename when old ID equals new ID (no-op)', () => {
            const nodeId: NodeIdAndFilePath = 'folder/same.md'
            const graph: Graph = createGraph({
                [nodeId]: createTestNode(nodeId, [], undefined, '# Same')
            })

            // WHEN: "Rename" to same ID
            const delta: GraphDelta = computeRenameNodeDelta(nodeId, nodeId, graph)
            const resultGraph: Graph = applyGraphDeltaToGraph(graph, delta)

            // THEN: Node should still exist (delta creates upsert with same ID)
            expect(resultGraph.nodes[nodeId]).toBeDefined()
        })

        it('should exclude context nodes from incoming edge updates', () => {
            const oldId: NodeIdAndFilePath = 'folder/target.md'
            const newId: NodeIdAndFilePath = 'folder/renamed.md'

            const initialGraph: Graph = createGraph({
                'ctx-nodes/context.md': {
                    relativeFilePathIsID: 'ctx-nodes/context.md',
                    outgoingEdges: [createEdge(oldId)],
                    contentWithoutYamlOrLinks: '# Context\n\n[target]*',
                    nodeUIMetadata: {
                        color: O.none,
                        position: O.none,
                        additionalYAMLProps: new Map(),
                        isContextNode: true
                    }
                },
                [oldId]: createTestNode(oldId, [], undefined, '# Target')
            })

            // WHEN: Rename target
            const delta: GraphDelta = computeRenameNodeDelta(oldId, newId, initialGraph)
            const resultGraph: Graph = applyGraphDeltaToGraph(initialGraph, delta)

            // THEN: Context node should NOT be updated (excluded from rename)
            // Delta only has 1 entry (the renamed node itself)
            expect(delta).toHaveLength(1)

            // Context node should still point to old ID (unchanged)
            expect(resultGraph.nodes['ctx-nodes/context.md'].outgoingEdges[0].targetId).toBe(oldId)
        })
    })
})
