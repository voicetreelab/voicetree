import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphNode } from '@/pure/graph'
import { fromCreateChildToUpsertNode, generateChildNodeId } from './uiInteractionsToGraphDeltas'

/**
 * Tests for child node ID generation.
 *
 * Key behavior: Children of context nodes should NOT be placed in ctx-nodes/ folder.
 * The ctx-nodes/ folder should only contain actual context nodes (isContextNode: true).
 */

function createTestNode(nodeId: string, edgeCount: number = 0): GraphNode {
    return {
        relativeFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: '# Test',
        outgoingEdges: Array.from({ length: edgeCount }, (_, i) => ({
            targetId: `child_${i}.md`,
            label: ''
        })),
        nodeUIMetadata: {
            color: O.none,
            position: O.some({ x: 0, y: 0 }),
            additionalYAMLProps: new Map(),
            isContextNode: false
        }
    }
}

describe('generateChildNodeId', () => {
    describe('regular nodes (not in ctx-nodes/)', () => {
        it('should place child in same folder as parent', () => {
            const parentNode: GraphNode = createTestNode('tuesday/some_node.md', 0)
            expect(generateChildNodeId(parentNode)).toBe('tuesday/some_node_0.md')
        })

        it('should place child at root when parent is at root', () => {
            const parentNode: GraphNode = createTestNode('root_node.md', 0)
            expect(generateChildNodeId(parentNode)).toBe('root_node_0.md')
        })

        it('should handle deeply nested regular folders', () => {
            const parentNode: GraphNode = createTestNode('a/b/c/d/node.md', 0)
            expect(generateChildNodeId(parentNode)).toBe('a/b/c/d/node_0.md')
        })
    })

    describe('context nodes (in ctx-nodes/)', () => {
        it('should strip ctx-nodes/ when parent is in vault/ctx-nodes/', () => {
            const parentNode: GraphNode = createTestNode('tuesday/ctx-nodes/context_123.md', 0)
            expect(generateChildNodeId(parentNode)).toBe('tuesday/context_123_0.md')
        })

        it('should strip ctx-nodes/ when parent is at root ctx-nodes/', () => {
            const parentNode: GraphNode = createTestNode('ctx-nodes/context_node.md', 0)
            expect(generateChildNodeId(parentNode)).toBe('context_node_0.md')
        })

        it('should strip ctx-nodes/ from deeply nested path', () => {
            const parentNode: GraphNode = createTestNode('vault/subfolder/ctx-nodes/deep_context.md', 0)
            expect(generateChildNodeId(parentNode)).toBe('vault/subfolder/deep_context_0.md')
        })

        it('should handle context node with _context_ in filename', () => {
            const parentNode: GraphNode = createTestNode('tuesday/ctx-nodes/node_context_1234567890.md', 0)
            expect(generateChildNodeId(parentNode)).toBe('tuesday/node_context_1234567890_0.md')
        })
    })

    describe('edge count indexing', () => {
        it('should use _0 suffix when parent has no edges', () => {
            const parentNode: GraphNode = createTestNode('node.md', 0)
            expect(generateChildNodeId(parentNode)).toBe('node_0.md')
        })

        it('should use _1 suffix when parent has 1 edge', () => {
            const parentNode: GraphNode = createTestNode('node.md', 1)
            expect(generateChildNodeId(parentNode)).toBe('node_1.md')
        })

        it('should use _5 suffix when parent has 5 edges', () => {
            const parentNode: GraphNode = createTestNode('ctx-nodes/context.md', 5)
            expect(generateChildNodeId(parentNode)).toBe('context_5.md')
        })
    })

    describe('edge cases', () => {
        it('should not match partial folder names like "my-ctx-nodes"', () => {
            const parentNode: GraphNode = createTestNode('my-ctx-nodes/node.md', 0)
            // Should NOT strip because it's not exactly "ctx-nodes/"
            expect(generateChildNodeId(parentNode)).toBe('my-ctx-nodes/node_0.md')
        })

        it('should not match "ctx-nodes" without trailing slash in filename', () => {
            const parentNode: GraphNode = createTestNode('ctx-nodes-backup/node.md', 0)
            expect(generateChildNodeId(parentNode)).toBe('ctx-nodes-backup/node_0.md')
        })

        it('should handle voice subfolder inside ctx-nodes', () => {
            // Real case: ctx-nodes/voice/Problem_Child_Nodes.md
            const parentNode: GraphNode = createTestNode('tuesday/ctx-nodes/voice/Problem_Child.md', 0)
            expect(generateChildNodeId(parentNode)).toBe('tuesday/voice/Problem_Child_0.md')
        })
    })
})

describe('fromCreateChildToUpsertNode', () => {
    const emptyGraph: Graph = { nodes: {} }

    it('should generate child ID in same folder for regular nodes', () => {
        const parentNode: GraphNode = createTestNode('tuesday/some_node.md', 0)

        const delta = fromCreateChildToUpsertNode(emptyGraph, parentNode)

        expect(delta).toHaveLength(2) // child + updated parent
        expect(delta[0].type).toBe('UpsertNode')
        if (delta[0].type === 'UpsertNode') {
            expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe('tuesday/some_node_0.md')
        }
    })

    it('should strip ctx-nodes/ from child ID when parent is in ctx-nodes/', () => {
        const parentNode: GraphNode = createTestNode('tuesday/ctx-nodes/parent_context_123.md', 0)

        const delta = fromCreateChildToUpsertNode(emptyGraph, parentNode)

        expect(delta).toHaveLength(2)
        expect(delta[0].type).toBe('UpsertNode')
        if (delta[0].type === 'UpsertNode') {
            const childId: string = delta[0].nodeToUpsert.relativeFilePathIsID
            expect(childId).not.toContain('ctx-nodes/')
            expect(childId).toBe('tuesday/parent_context_123_0.md')
        }
    })

    it('should use provided newFilePathIsID when explicitly passed', () => {
        const parentNode: GraphNode = createTestNode('ctx-nodes/context.md', 0)
        const explicitChildId = 'custom/path/child.md'

        const delta = fromCreateChildToUpsertNode(emptyGraph, parentNode, '# Custom', explicitChildId)

        expect(delta[0].type).toBe('UpsertNode')
        if (delta[0].type === 'UpsertNode') {
            expect(delta[0].nodeToUpsert.relativeFilePathIsID).toBe(explicitChildId)
        }
    })
})
