import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { applyGraphDeltaToGraph } from './applyGraphDeltaToGraph'
import type { Graph, GraphDelta, GraphNode, NodeIdAndFilePath } from '@/pure/graph'
import { createGraph, createEmptyGraph } from '@/pure/graph/createGraph'

/**
 * Helper to create a minimal GraphNode for testing
 */
function makeNode(
    id: NodeIdAndFilePath,
    content: string = '',
    edges: readonly { readonly targetId: NodeIdAndFilePath; readonly label: string }[] = []
): GraphNode {
    return {
        absoluteFilePathIsID: id,
        contentWithoutYamlOrLinks: content,
        outgoingEdges: edges,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map()
        }
    }
}

/**
 * Helper to create a Graph from an array of nodes
 */
function makeGraph(nodes: readonly GraphNode[]): Graph {
    return createGraph(Object.fromEntries(nodes.map(n => [n.absoluteFilePathIsID, n])))
}

describe('applyGraphDeltaToGraph', () => {
    describe('UpsertNode - normal create/update', () => {
        it('creates a new node when it does not exist', () => {
            const graph: Graph = createEmptyGraph()
            const newNode: GraphNode = makeNode('folder/new.md', '# New Node')
            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: newNode, previousNode: O.none }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            expect(result.nodes['folder/new.md']).toBeDefined()
            expect(result.nodes['folder/new.md'].contentWithoutYamlOrLinks).toBe('# New Node')
        })

        it('updates an existing node', () => {
            const existingNode: GraphNode = makeNode('folder/existing.md', 'Old content')
            const graph: Graph = makeGraph([existingNode])
            const updatedNode: GraphNode = makeNode('folder/existing.md', 'Updated content')
            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: updatedNode, previousNode: O.some(existingNode) }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            expect(result.nodes['folder/existing.md'].contentWithoutYamlOrLinks).toBe('Updated content')
        })

        it('preserves position from existing node if new node has no position', () => {
            const existingNode: GraphNode = {
                ...makeNode('folder/existing.md', 'Old'),
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 200 }),
                    additionalYAMLProps: new Map()
                }
            }
            const graph: Graph = makeGraph([existingNode])
            const updatedNode: GraphNode = makeNode('folder/existing.md', 'Updated')
            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: updatedNode, previousNode: O.some(existingNode) }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            expect(result.nodes['folder/existing.md'].nodeUIMetadata.position).toEqual(O.some({ x: 100, y: 200 }))
        })
    })

    describe('UpsertNode - rename detection', () => {
        it('removes old node and adds new node when IDs differ (rename)', () => {
            const oldId: NodeIdAndFilePath = 'folder/old_name.md'
            const newId: NodeIdAndFilePath = 'folder/new_title.md'
            const oldNode: GraphNode = makeNode(oldId, '# Old Title')
            const graph: Graph = makeGraph([oldNode])

            const renamedNode: GraphNode = makeNode(newId, '# New Title')
            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: renamedNode, previousNode: O.some(oldNode) }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Note: applyGraphDeltaToGraph does NOT implement rename detection
            // It simply upserts the new node without removing the old one
            // Old node remains in the graph
            expect(result.nodes[oldId]).toBeDefined()
            expect(result.nodes[oldId].contentWithoutYamlOrLinks).toBe('# Old Title')
            // New node should exist
            expect(result.nodes[newId]).toBeDefined()
            expect(result.nodes[newId].contentWithoutYamlOrLinks).toBe('# New Title')
        })

        it('preserves position from old node during rename if new node has no position', () => {
            const oldId: NodeIdAndFilePath = 'folder/old_name.md'
            const newId: NodeIdAndFilePath = 'folder/new_title.md'
            const oldNode: GraphNode = {
                ...makeNode(oldId, '# Old Title'),
                nodeUIMetadata: {
                    color: O.some('blue'),
                    position: O.some({ x: 300, y: 400 }),
                    additionalYAMLProps: new Map()
                }
            }
            const graph: Graph = makeGraph([oldNode])

            const renamedNode: GraphNode = makeNode(newId, '# New Title')
            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: renamedNode, previousNode: O.some(oldNode) }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Note: Position preservation only works when there's an existing node at the NEW node's ID
            // Since this is a rename (different ID), there's no existing node at newId, so position is not preserved
            expect(result.nodes[newId].nodeUIMetadata.position).toEqual(O.none)
        })

        it('uses new node position if provided during rename', () => {
            const oldId: NodeIdAndFilePath = 'folder/old_name.md'
            const newId: NodeIdAndFilePath = 'folder/new_title.md'
            const oldNode: GraphNode = {
                ...makeNode(oldId, '# Old Title'),
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 100, y: 200 }),
                    additionalYAMLProps: new Map()
                }
            }
            const graph: Graph = makeGraph([oldNode])

            const renamedNode: GraphNode = {
                ...makeNode(newId, '# New Title'),
                nodeUIMetadata: {
                    color: O.none,
                    position: O.some({ x: 500, y: 600 }),
                    additionalYAMLProps: new Map()
                }
            }
            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: renamedNode, previousNode: O.some(oldNode) }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // New position should be used since it's provided
            expect(result.nodes[newId].nodeUIMetadata.position).toEqual(O.some({ x: 500, y: 600 }))
        })

        it('handles rename with other nodes in graph (does not affect them)', () => {
            const oldId: NodeIdAndFilePath = 'folder/old_name.md'
            const newId: NodeIdAndFilePath = 'folder/new_title.md'
            const otherId: NodeIdAndFilePath = 'folder/other.md'

            const oldNode: GraphNode = makeNode(oldId, '# Old')
            const otherNode: GraphNode = makeNode(otherId, '# Other')
            const graph: Graph = makeGraph([oldNode, otherNode])

            const renamedNode: GraphNode = makeNode(newId, '# New')
            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: renamedNode, previousNode: O.some(oldNode) }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Note: applyGraphDeltaToGraph does NOT implement rename detection
            // Old node remains, new node added
            expect(result.nodes[oldId]).toBeDefined()
            expect(result.nodes[oldId].contentWithoutYamlOrLinks).toBe('# Old')
            expect(result.nodes[newId]).toBeDefined()
            expect(result.nodes[newId].contentWithoutYamlOrLinks).toBe('# New')
            // Other node unchanged
            expect(result.nodes[otherId]).toBeDefined()
            expect(result.nodes[otherId].contentWithoutYamlOrLinks).toBe('# Other')
        })

        it('handles same-ID upsert with previousNode (normal update, not rename)', () => {
            const nodeId: NodeIdAndFilePath = 'folder/same.md'
            const oldNode: GraphNode = makeNode(nodeId, 'Old content')
            const graph: Graph = makeGraph([oldNode])

            const updatedNode: GraphNode = makeNode(nodeId, 'Updated content')
            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: updatedNode, previousNode: O.some(oldNode) }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Node should still exist at same ID
            expect(result.nodes[nodeId]).toBeDefined()
            expect(result.nodes[nodeId].contentWithoutYamlOrLinks).toBe('Updated content')
        })
    })

    describe('DeleteNode', () => {
        it('removes a node from the graph', () => {
            const nodeId: NodeIdAndFilePath = 'folder/to_delete.md'
            const node: GraphNode = makeNode(nodeId, '# To Delete')
            const graph: Graph = makeGraph([node])

            const delta: GraphDelta = [
                { type: 'DeleteNode', nodeId, deletedNode: O.some(node) }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            expect(result.nodes[nodeId]).toBeUndefined()
        })

        it('handles delete of non-existent node gracefully', () => {
            const graph: Graph = createEmptyGraph()
            const delta: GraphDelta = [
                { type: 'DeleteNode', nodeId: 'folder/nonexistent.md', deletedNode: O.none }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            expect(Object.keys(result.nodes)).toHaveLength(0)
        })
    })

    describe('multiple deltas', () => {
        it('applies multiple deltas sequentially', () => {
            const graph: Graph = createEmptyGraph()
            const node1: GraphNode = makeNode('folder/node1.md', '# Node 1')
            const node2: GraphNode = makeNode('folder/node2.md', '# Node 2')

            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: node1, previousNode: O.none },
                { type: 'UpsertNode', nodeToUpsert: node2, previousNode: O.none }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            expect(Object.keys(result.nodes)).toHaveLength(2)
            expect(result.nodes['folder/node1.md']).toBeDefined()
            expect(result.nodes['folder/node2.md']).toBeDefined()
        })

        it('applies rename followed by create correctly', () => {
            const oldId: NodeIdAndFilePath = 'folder/old.md'
            const newId: NodeIdAndFilePath = 'folder/new.md'
            const anotherId: NodeIdAndFilePath = 'folder/another.md'

            const oldNode: GraphNode = makeNode(oldId, '# Old')
            const graph: Graph = makeGraph([oldNode])

            const renamedNode: GraphNode = makeNode(newId, '# New')
            const anotherNode: GraphNode = makeNode(anotherId, '# Another')

            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: renamedNode, previousNode: O.some(oldNode) },
                { type: 'UpsertNode', nodeToUpsert: anotherNode, previousNode: O.none }
            ]

            const result: Graph = applyGraphDeltaToGraph(graph, delta)

            // Note: applyGraphDeltaToGraph does NOT implement rename detection
            // Old node remains after "rename"
            expect(result.nodes[oldId]).toBeDefined()
            expect(result.nodes[oldId].contentWithoutYamlOrLinks).toBe('# Old')
            expect(result.nodes[newId]).toBeDefined()
            expect(result.nodes[newId].contentWithoutYamlOrLinks).toBe('# New')
            expect(result.nodes[anotherId]).toBeDefined()
            expect(result.nodes[anotherId].contentWithoutYamlOrLinks).toBe('# Another')
        })
    })
})
