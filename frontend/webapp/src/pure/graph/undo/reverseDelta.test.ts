import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { reverseDelta } from './reverseDelta'
import type { GraphDelta, GraphNode, UpsertNodeDelta, DeleteNode } from '@/pure/graph'

// Helper to create a minimal GraphNode for testing
function createTestNode(id: string, content: string = '# Test'): GraphNode {
    return {
        relativeFilePathIsID: id,
        contentWithoutYamlOrLinks: content,
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map()
        }
    }
}

describe('reverseDelta', () => {
    describe('UpsertNode reversal', () => {
        it('reverses CREATE (no previousNode) to DELETE', () => {
            const newNode: GraphNode = createTestNode('new.md', '# New Node')
            const delta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: newNode,
                previousNode: O.none
            }]

            const reversed: GraphDelta = reverseDelta(delta)

            expect(reversed).toHaveLength(1)
            expect(reversed[0].type).toBe('DeleteNode')
            const deleteAction: DeleteNode = reversed[0] as DeleteNode
            expect(deleteAction.nodeId).toBe('new.md')
            expect(O.isSome(deleteAction.deletedNode)).toBe(true)
            expect(O.toUndefined(deleteAction.deletedNode)).toEqual(newNode) // Saved for re-redo
        })

        it('reverses UPDATE (has previousNode) to restore previous state', () => {
            const previousNode: GraphNode = createTestNode('edit.md', '# Old Content')
            const updatedNode: GraphNode = createTestNode('edit.md', '# New Content')
            const delta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: updatedNode,
                previousNode: O.some(previousNode)
            }]

            const reversed: GraphDelta = reverseDelta(delta)

            expect(reversed).toHaveLength(1)
            expect(reversed[0].type).toBe('UpsertNode')
            const upsertAction: UpsertNodeDelta = reversed[0] as UpsertNodeDelta
            expect(upsertAction.nodeToUpsert).toEqual(previousNode) // Restore old state
            expect(O.toUndefined(upsertAction.previousNode)).toEqual(updatedNode) // Swap: new becomes previous
        })
    })

    describe('DeleteNode reversal', () => {
        it('reverses DELETE (has deletedNode) to CREATE', () => {
            const deletedNode: GraphNode = createTestNode('deleted.md', '# Deleted Content')
            const delta: GraphDelta = [{
                type: 'DeleteNode',
                nodeId: 'deleted.md',
                deletedNode: O.some(deletedNode)
            }]

            const reversed: GraphDelta = reverseDelta(delta)

            expect(reversed).toHaveLength(1)
            expect(reversed[0].type).toBe('UpsertNode')
            const upsertAction: UpsertNodeDelta = reversed[0] as UpsertNodeDelta
            expect(upsertAction.nodeToUpsert).toEqual(deletedNode) // Recreate node
            expect(O.isNone(upsertAction.previousNode)).toBe(true) // It's new again
        })

        it('returns empty for DELETE without deletedNode (cannot reverse)', () => {
            const delta: GraphDelta = [{
                type: 'DeleteNode',
                nodeId: 'unknown.md',
                deletedNode: O.none
            }]

            const reversed: GraphDelta = reverseDelta(delta)

            expect(reversed).toHaveLength(0)
        })
    })

    describe('multi-action delta reversal', () => {
        it('reverses actions in reverse order', () => {
            const nodeA: GraphNode = createTestNode('a.md', '# A')
            const nodeB: GraphNode = createTestNode('b.md', '# B')
            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: nodeA, previousNode: O.none },
                { type: 'UpsertNode', nodeToUpsert: nodeB, previousNode: O.none }
            ]

            const reversed: GraphDelta = reverseDelta(delta)

            expect(reversed).toHaveLength(2)
            // Should be reversed: B first, then A
            expect((reversed[0] as DeleteNode).nodeId).toBe('b.md')
            expect((reversed[1] as DeleteNode).nodeId).toBe('a.md')
        })

        it('reverses create child + update parent correctly', () => {
            const parentBefore: GraphNode = createTestNode('parent.md', '# Parent')
            const parentAfter: GraphNode = {
                ...parentBefore,
                outgoingEdges: [{ targetId: 'child.md', label: '' }]
            }
            const child: GraphNode = createTestNode('child.md', '# Child')

            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: child, previousNode: O.none },
                { type: 'UpsertNode', nodeToUpsert: parentAfter, previousNode: O.some(parentBefore) }
            ]

            const reversed: GraphDelta = reverseDelta(delta)

            expect(reversed).toHaveLength(2)
            // Parent restore comes first (was second in original, reversed order)
            expect(reversed[0].type).toBe('UpsertNode')
            expect((reversed[0] as UpsertNodeDelta).nodeToUpsert).toEqual(parentBefore)
            // Child delete comes second
            expect(reversed[1].type).toBe('DeleteNode')
            expect((reversed[1] as DeleteNode).nodeId).toBe('child.md')
        })
    })

    describe('edge cases', () => {
        it('returns empty array for empty delta', () => {
            const reversed: GraphDelta = reverseDelta([])
            expect(reversed).toEqual([])
        })

        it('preserves node metadata during reversal', () => {
            const nodeWithMetadata: GraphNode = createTestNode('meta.md', '# With Metadata')
            const nodeWithColor: GraphNode = {
                ...nodeWithMetadata,
                nodeUIMetadata: {
                    ...nodeWithMetadata.nodeUIMetadata,
                    color: O.some('purple'),
                    position: O.some({ x: 100, y: 200 })
                }
            }

            const delta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: nodeWithColor,
                previousNode: O.none
            }]

            const reversed: GraphDelta = reverseDelta(delta)
            const deleteAction: DeleteNode = reversed[0] as DeleteNode

            expect(O.isSome(deleteAction.deletedNode)).toBe(true)
            const deletedNode: GraphNode = O.toUndefined(deleteAction.deletedNode)!
            expect(deletedNode).toEqual(nodeWithColor)
            expect(O.isSome(deletedNode.nodeUIMetadata.color)).toBe(true)
        })
    })
})
