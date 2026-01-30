import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { computeRenameNodeDelta } from './computeRenameNodeDelta'
import { createGraph } from '@/pure/graph/createGraph'
import type { Graph, GraphDelta, GraphNode, NodeDelta, NodeIdAndFilePath, UpsertNodeDelta } from '@/pure/graph'

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

describe('computeRenameNodeDelta', () => {
    describe('basic rename (no incoming edges)', () => {
        it('creates UpsertNode delta with new ID and previousNode with old ID', () => {
            const oldNodeId: NodeIdAndFilePath = 'folder/old_name.md'
            const newNodeId: NodeIdAndFilePath = 'folder/new_title.md'
            const node: GraphNode = makeNode(oldNodeId, '# Old Name\n\nSome content')
            const graph: Graph = makeGraph([node])

            const delta: GraphDelta = computeRenameNodeDelta(oldNodeId, newNodeId, graph)

            // Should have exactly 1 delta (the renamed node)
            expect(delta).toHaveLength(1)

            const renamedNodeDelta: UpsertNodeDelta = delta[0] as UpsertNodeDelta
            expect(renamedNodeDelta.type).toBe('UpsertNode')

            // nodeToUpsert should have the NEW ID
            expect(renamedNodeDelta.nodeToUpsert.absoluteFilePathIsID).toBe(newNodeId)

            // previousNode should have the OLD ID
            expect(O.isSome(renamedNodeDelta.previousNode)).toBe(true)
            if (O.isSome(renamedNodeDelta.previousNode)) {
                expect(renamedNodeDelta.previousNode.value.absoluteFilePathIsID).toBe(oldNodeId)
            }

            // Content should be preserved
            expect(renamedNodeDelta.nodeToUpsert.contentWithoutYamlOrLinks).toBe('# Old Name\n\nSome content')
        })

        it('preserves node metadata during rename', () => {
            const oldNodeId: NodeIdAndFilePath = 'folder/old_name.md'
            const newNodeId: NodeIdAndFilePath = 'folder/new_title.md'
            const node: GraphNode = {
                absoluteFilePathIsID: oldNodeId,
                contentWithoutYamlOrLinks: '# Title',
                outgoingEdges: [],
                nodeUIMetadata: {
                    color: O.some('blue'),
                    position: O.some({ x: 100, y: 200 }),
                    additionalYAMLProps: new Map([['agent_name', 'Test']])
                }
            }
            const graph: Graph = makeGraph([node])

            const delta: GraphDelta = computeRenameNodeDelta(oldNodeId, newNodeId, graph)
            const renamedNodeDelta: UpsertNodeDelta = delta[0] as UpsertNodeDelta

            expect(renamedNodeDelta.nodeToUpsert.nodeUIMetadata.color).toEqual(O.some('blue'))
            expect(renamedNodeDelta.nodeToUpsert.nodeUIMetadata.position).toEqual(O.some({ x: 100, y: 200 }))
        })

        it('preserves outgoing edges during rename', () => {
            const oldNodeId: NodeIdAndFilePath = 'folder/old_name.md'
            const newNodeId: NodeIdAndFilePath = 'folder/new_title.md'
            const targetId: NodeIdAndFilePath = 'folder/target.md'
            const node: GraphNode = makeNode(oldNodeId, 'Content with [target]*', [
                { targetId, label: '' }
            ])
            const targetNode: GraphNode = makeNode(targetId)
            const graph: Graph = makeGraph([node, targetNode])

            const delta: GraphDelta = computeRenameNodeDelta(oldNodeId, newNodeId, graph)
            const renamedNodeDelta: UpsertNodeDelta = delta[0] as UpsertNodeDelta

            // Outgoing edges should be preserved
            expect(renamedNodeDelta.nodeToUpsert.outgoingEdges).toHaveLength(1)
            expect(renamedNodeDelta.nodeToUpsert.outgoingEdges[0].targetId).toBe(targetId)
        })
    })

    describe('rename with incoming edges', () => {
        it('creates deltas for nodes with incoming edges (updated edge + content)', () => {
            const oldNodeId: NodeIdAndFilePath = 'folder/old_name.md'
            const newNodeId: NodeIdAndFilePath = 'folder/new_title.md'
            const sourceNodeId: NodeIdAndFilePath = 'folder/source.md'

            const nodeToRename: GraphNode = makeNode(oldNodeId, '# Old Name')
            const sourceNode: GraphNode = makeNode(sourceNodeId, 'Links to [old_name]*', [
                { targetId: oldNodeId, label: '' }
            ])
            const graph: Graph = makeGraph([nodeToRename, sourceNode])

            const delta: GraphDelta = computeRenameNodeDelta(oldNodeId, newNodeId, graph)

            // Should have 2 deltas: renamed node + source node with updated edge
            expect(delta).toHaveLength(2)

            // Find the source node delta
            const sourceNodeDelta: UpsertNodeDelta | undefined = delta.find(
                (d: NodeDelta): boolean => d.type === 'UpsertNode' && d.nodeToUpsert.absoluteFilePathIsID === sourceNodeId
            ) as UpsertNodeDelta | undefined

            expect(sourceNodeDelta).toBeDefined()
            expect(sourceNodeDelta!.nodeToUpsert.outgoingEdges[0].targetId).toBe(newNodeId)
            expect(sourceNodeDelta!.nodeToUpsert.contentWithoutYamlOrLinks).toBe('Links to [new_title]*')

            // previousNode should be the original source node
            expect(O.isSome(sourceNodeDelta!.previousNode)).toBe(true)
            if (O.isSome(sourceNodeDelta!.previousNode)) {
                expect(sourceNodeDelta!.previousNode.value.outgoingEdges[0].targetId).toBe(oldNodeId)
            }
        })

        it('handles multiple incoming edges from different nodes', () => {
            const oldNodeId: NodeIdAndFilePath = 'folder/target.md'
            const newNodeId: NodeIdAndFilePath = 'folder/renamed_target.md'
            const source1Id: NodeIdAndFilePath = 'folder/source1.md'
            const source2Id: NodeIdAndFilePath = 'folder/source2.md'

            const targetNode: GraphNode = makeNode(oldNodeId, '# Target')
            const source1: GraphNode = makeNode(source1Id, 'Links to [target]*', [
                { targetId: oldNodeId, label: '' }
            ])
            const source2: GraphNode = makeNode(source2Id, 'Also links to [target]*', [
                { targetId: oldNodeId, label: '' }
            ])
            const graph: Graph = makeGraph([targetNode, source1, source2])

            const delta: GraphDelta = computeRenameNodeDelta(oldNodeId, newNodeId, graph)

            // Should have 3 deltas: renamed node + 2 source nodes
            expect(delta).toHaveLength(3)

            // Both source nodes should have updated edges
            const source1Delta: UpsertNodeDelta = delta.find(
                (d: NodeDelta): boolean => d.type === 'UpsertNode' && d.nodeToUpsert.absoluteFilePathIsID === source1Id
            ) as UpsertNodeDelta
            const source2Delta: UpsertNodeDelta = delta.find(
                (d: NodeDelta): boolean => d.type === 'UpsertNode' && d.nodeToUpsert.absoluteFilePathIsID === source2Id
            ) as UpsertNodeDelta

            expect(source1Delta.nodeToUpsert.outgoingEdges[0].targetId).toBe(newNodeId)
            expect(source2Delta.nodeToUpsert.outgoingEdges[0].targetId).toBe(newNodeId)
        })

        it('handles node with multiple edges to renamed node', () => {
            const oldNodeId: NodeIdAndFilePath = 'folder/target.md'
            const newNodeId: NodeIdAndFilePath = 'folder/renamed.md'
            const sourceId: NodeIdAndFilePath = 'folder/source.md'

            const targetNode: GraphNode = makeNode(oldNodeId, '# Target')
            const sourceNode: GraphNode = makeNode(sourceId, 'First [target]* and second [target]*', [
                { targetId: oldNodeId, label: 'rel1' },
                { targetId: oldNodeId, label: 'rel2' }
            ])
            const graph: Graph = makeGraph([targetNode, sourceNode])

            const delta: GraphDelta = computeRenameNodeDelta(oldNodeId, newNodeId, graph)

            const sourceDelta: UpsertNodeDelta = delta.find(
                (d: NodeDelta): boolean => d.type === 'UpsertNode' && d.nodeToUpsert.absoluteFilePathIsID === sourceId
            ) as UpsertNodeDelta

            // Both edges should be updated
            expect(sourceDelta.nodeToUpsert.outgoingEdges).toHaveLength(2)
            expect(sourceDelta.nodeToUpsert.outgoingEdges[0].targetId).toBe(newNodeId)
            expect(sourceDelta.nodeToUpsert.outgoingEdges[1].targetId).toBe(newNodeId)

            // Content should have both placeholders updated
            expect(sourceDelta.nodeToUpsert.contentWithoutYamlOrLinks).toBe('First [renamed]* and second [renamed]*')
        })
    })

    describe('edge cases', () => {
        it('handles node with no incoming edges (only renamed node delta)', () => {
            const oldNodeId: NodeIdAndFilePath = 'folder/isolated.md'
            const newNodeId: NodeIdAndFilePath = 'folder/renamed.md'
            const unrelatedId: NodeIdAndFilePath = 'folder/unrelated.md'

            const isolatedNode: GraphNode = makeNode(oldNodeId, '# Isolated')
            const unrelatedNode: GraphNode = makeNode(unrelatedId, 'No links here')
            const graph: Graph = makeGraph([isolatedNode, unrelatedNode])

            const delta: GraphDelta = computeRenameNodeDelta(oldNodeId, newNodeId, graph)

            // Only the renamed node delta
            expect(delta).toHaveLength(1)
            expect(delta[0].type).toBe('UpsertNode')
            expect((delta[0] as UpsertNodeDelta).nodeToUpsert.absoluteFilePathIsID).toBe(newNodeId)
        })

        it('does not create delta for node with edge to different target', () => {
            const oldNodeId: NodeIdAndFilePath = 'folder/target.md'
            const newNodeId: NodeIdAndFilePath = 'folder/renamed.md'
            const sourceId: NodeIdAndFilePath = 'folder/source.md'
            const otherId: NodeIdAndFilePath = 'folder/other.md'

            const targetNode: GraphNode = makeNode(oldNodeId, '# Target')
            const otherNode: GraphNode = makeNode(otherId, '# Other')
            // Source points to 'other', not 'target'
            const sourceNode: GraphNode = makeNode(sourceId, 'Links to [other]*', [
                { targetId: otherId, label: '' }
            ])
            const graph: Graph = makeGraph([targetNode, otherNode, sourceNode])

            const delta: GraphDelta = computeRenameNodeDelta(oldNodeId, newNodeId, graph)

            // Only the renamed node delta (source is not affected)
            expect(delta).toHaveLength(1)
        })

        it('excludes context nodes from incoming edge updates', () => {
            const oldNodeId: NodeIdAndFilePath = 'folder/target.md'
            const newNodeId: NodeIdAndFilePath = 'folder/renamed.md'
            const contextNodeId: NodeIdAndFilePath = 'ctx-nodes/context.md'

            const targetNode: GraphNode = makeNode(oldNodeId, '# Target')
            const contextNode: GraphNode = {
                absoluteFilePathIsID: contextNodeId,
                contentWithoutYamlOrLinks: 'Links to [target]*',
                outgoingEdges: [{ targetId: oldNodeId, label: '' }],
                nodeUIMetadata: {
                    color: O.none,
                    position: O.none,
                    additionalYAMLProps: new Map(),
                    isContextNode: true
                }
            }
            const graph: Graph = makeGraph([targetNode, contextNode])

            const delta: GraphDelta = computeRenameNodeDelta(oldNodeId, newNodeId, graph)

            // Only the renamed node delta (context node is excluded)
            expect(delta).toHaveLength(1)
        })
    })
})
