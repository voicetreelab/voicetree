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
            const newNode = createTestNode('new.md', '# New Node')
            const delta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: newNode,
                previousNode: undefined
            }]

            const reversed = reverseDelta(delta)

            expect(reversed).toHaveLength(1)
            expect(reversed[0].type).toBe('DeleteNode')
            const deleteAction = reversed[0] as DeleteNode
            expect(deleteAction.nodeId).toBe('new.md')
            expect(deleteAction.deletedNode).toEqual(newNode) // Saved for re-redo
        })

        it('reverses UPDATE (has previousNode) to restore previous state', () => {
            const previousNode = createTestNode('edit.md', '# Old Content')
            const updatedNode = createTestNode('edit.md', '# New Content')
            const delta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: updatedNode,
                previousNode: previousNode
            }]

            const reversed = reverseDelta(delta)

            expect(reversed).toHaveLength(1)
            expect(reversed[0].type).toBe('UpsertNode')
            const upsertAction = reversed[0] as UpsertNodeDelta
            expect(upsertAction.nodeToUpsert).toEqual(previousNode) // Restore old state
            expect(upsertAction.previousNode).toEqual(updatedNode) // Swap: new becomes previous
        })
    })

    describe('DeleteNode reversal', () => {
        it('reverses DELETE (has deletedNode) to CREATE', () => {
            const deletedNode = createTestNode('deleted.md', '# Deleted Content')
            const delta: GraphDelta = [{
                type: 'DeleteNode',
                nodeId: 'deleted.md',
                deletedNode: deletedNode
            }]

            const reversed = reverseDelta(delta)

            expect(reversed).toHaveLength(1)
            expect(reversed[0].type).toBe('UpsertNode')
            const upsertAction = reversed[0] as UpsertNodeDelta
            expect(upsertAction.nodeToUpsert).toEqual(deletedNode) // Recreate node
            expect(upsertAction.previousNode).toBeUndefined() // It's new again
        })

        it('returns empty for DELETE without deletedNode (cannot reverse)', () => {
            const delta: GraphDelta = [{
                type: 'DeleteNode',
                nodeId: 'unknown.md',
                deletedNode: undefined
            }]

            const reversed = reverseDelta(delta)

            expect(reversed).toHaveLength(0)
        })
    })

    describe('multi-action delta reversal', () => {
        it('reverses actions in reverse order', () => {
            const nodeA = createTestNode('a.md', '# A')
            const nodeB = createTestNode('b.md', '# B')
            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: nodeA, previousNode: undefined },
                { type: 'UpsertNode', nodeToUpsert: nodeB, previousNode: undefined }
            ]

            const reversed = reverseDelta(delta)

            expect(reversed).toHaveLength(2)
            // Should be reversed: B first, then A
            expect((reversed[0] as DeleteNode).nodeId).toBe('b.md')
            expect((reversed[1] as DeleteNode).nodeId).toBe('a.md')
        })

        it('reverses create child + update parent correctly', () => {
            const parentBefore = createTestNode('parent.md', '# Parent')
            const parentAfter = {
                ...parentBefore,
                outgoingEdges: [{ targetId: 'child.md', label: '' }]
            }
            const child = createTestNode('child.md', '# Child')

            const delta: GraphDelta = [
                { type: 'UpsertNode', nodeToUpsert: child, previousNode: undefined },
                { type: 'UpsertNode', nodeToUpsert: parentAfter, previousNode: parentBefore }
            ]

            const reversed = reverseDelta(delta)

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
            const reversed = reverseDelta([])
            expect(reversed).toEqual([])
        })

        it('preserves node metadata during reversal', () => {
            const nodeWithMetadata = createTestNode('meta.md', '# With Metadata')
            nodeWithMetadata.nodeUIMetadata.color
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
                previousNode: undefined
            }]

            const reversed = reverseDelta(delta)
            const deleteAction = reversed[0] as DeleteNode

            expect(deleteAction.deletedNode).toEqual(nodeWithColor)
            expect(O.isSome(deleteAction.deletedNode!.nodeUIMetadata.color)).toBe(true)
        })
    })
})
