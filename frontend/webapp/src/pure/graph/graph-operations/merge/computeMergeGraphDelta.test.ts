import { describe, it, expect } from 'vitest'
import { computeMergeGraphDelta } from './computeMergeGraphDelta'
import type { Graph, GraphNode, Edge, GraphDelta } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

// Helper to create a minimal GraphNode
function createNode(
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
            additionalYAMLProps: new Map()
        }
    }
}

// Helper to create an edge
function createEdge(targetId: string, label = ''): Edge {
    return { targetId, label }
}

describe('computeMergeGraphDelta', () => {
    it('should return empty delta when less than 2 nodes selected', () => {
        const graph: Graph = {
            nodes: {
                'node1.md': createNode('node1.md')
            }
        }

        const result: GraphDelta = computeMergeGraphDelta(['node1.md'], graph)

        expect(result).toEqual([])
    })

    it('should return empty delta when selected nodes do not exist in graph', () => {
        const graph: Graph = {
            nodes: {
                'other.md': createNode('other.md')
            }
        }

        const result: GraphDelta = computeMergeGraphDelta(['missing1.md', 'missing2.md'], graph)

        expect(result).toEqual([])
    })

    it('should create representative node and delete selected nodes', () => {
        const graph: Graph = {
            nodes: {
                'node1.md': createNode('node1.md', [], { x: 0, y: 0 }, '# First'),
                'node2.md': createNode('node2.md', [], { x: 100, y: 100 }, '# Second')
            }
        }

        const result: GraphDelta = computeMergeGraphDelta(['node1.md', 'node2.md'], graph)

        // Should have 3 deltas: 1 UpsertNode for representative, 2 DeleteNode for originals
        expect(result).toHaveLength(3)

        // First should be UpsertNode for representative
        expect(result[0].type).toBe('UpsertNode')
        if (result[0].type === 'UpsertNode') {
            expect(result[0].nodeToUpsert.contentWithoutYamlOrLinks).toBe('# Merged: First, Second')
            // Centroid of (0,0) and (100,100) is (50,50)
            expect(O.isSome(result[0].nodeToUpsert.nodeUIMetadata.position)).toBe(true)
            if (O.isSome(result[0].nodeToUpsert.nodeUIMetadata.position)) {
                expect(result[0].nodeToUpsert.nodeUIMetadata.position.value.x).toBe(50)
                expect(result[0].nodeToUpsert.nodeUIMetadata.position.value.y).toBe(50)
            }
        }

        // Last two should be DeleteNode
        expect(result[1].type).toBe('DeleteNode')
        expect(result[2].type).toBe('DeleteNode')
        if (result[1].type === 'DeleteNode' && result[2].type === 'DeleteNode') {
            const deletedIds: readonly string[] = [result[1].nodeId, result[2].nodeId]
            expect(deletedIds).toContain('node1.md')
            expect(deletedIds).toContain('node2.md')
        }
    })

    it('should redirect incoming edges from external nodes to representative', () => {
        const graph: Graph = {
            nodes: {
                'external.md': createNode('external.md', [
                    createEdge('internal1.md', 'link to internal1')
                ]),
                'internal1.md': createNode('internal1.md', [], { x: 0, y: 0 }),
                'internal2.md': createNode('internal2.md', [], { x: 100, y: 100 })
            }
        }

        const result: GraphDelta = computeMergeGraphDelta(['internal1.md', 'internal2.md'], graph)

        // Should have 4 deltas: 1 representative + 1 updated external + 2 deletes
        expect(result).toHaveLength(4)

        // First is new representative
        expect(result[0].type).toBe('UpsertNode')

        // Second should be updated external node with redirected edge
        expect(result[1].type).toBe('UpsertNode')
        if (result[1].type === 'UpsertNode') {
            expect(result[1].nodeToUpsert.relativeFilePathIsID).toBe('external.md')
            expect(result[1].nodeToUpsert.outgoingEdges).toHaveLength(1)
            // Edge should now point to the new representative (starts with VT/merged_)
            expect(result[1].nodeToUpsert.outgoingEdges[0].targetId).toMatch(/^VT\/merged_/)
            expect(result[1].nodeToUpsert.outgoingEdges[0].label).toBe('link to internal1')
        }
    })

    it('should handle multiple external nodes with edges to subgraph', () => {
        const graph: Graph = {
            nodes: {
                'ext1.md': createNode('ext1.md', [createEdge('internal.md', 'from ext1')]),
                'ext2.md': createNode('ext2.md', [createEdge('internal.md', 'from ext2')]),
                'internal.md': createNode('internal.md', [], { x: 50, y: 50 }),
                'internal2.md': createNode('internal2.md', [], { x: 60, y: 60 })
            }
        }

        const result: GraphDelta = computeMergeGraphDelta(['internal.md', 'internal2.md'], graph)

        // 1 representative + 2 updated externals + 2 deletes = 5
        expect(result).toHaveLength(5)

        // Count UpsertNode operations (should be 3: representative + 2 externals)
        const upserts: readonly { type: string }[] = result.filter((d) => d.type === 'UpsertNode')
        expect(upserts).toHaveLength(3)

        // Count DeleteNode operations (should be 2)
        const deletes: readonly { type: string }[] = result.filter((d) => d.type === 'DeleteNode')
        expect(deletes).toHaveLength(2)
    })

    it('should not include external nodes that have no edges to subgraph', () => {
        const graph: Graph = {
            nodes: {
                'unrelated.md': createNode('unrelated.md', [createEdge('other.md')]),
                'other.md': createNode('other.md'),
                'internal1.md': createNode('internal1.md', [], { x: 0, y: 0 }),
                'internal2.md': createNode('internal2.md', [], { x: 100, y: 100 })
            }
        }

        const result: GraphDelta = computeMergeGraphDelta(['internal1.md', 'internal2.md'], graph)

        // Should only have 3 deltas: 1 representative + 2 deletes (no external updates)
        expect(result).toHaveLength(3)
    })

    it('should redirect multiple edges from same external node to different subgraph nodes', () => {
        const graph: Graph = {
            nodes: {
                'external.md': createNode('external.md', [
                    createEdge('internal1.md', 'link1'),
                    createEdge('internal2.md', 'link2')
                ]),
                'internal1.md': createNode('internal1.md', [], { x: 0, y: 0 }),
                'internal2.md': createNode('internal2.md', [], { x: 100, y: 100 })
            }
        }

        const result: GraphDelta = computeMergeGraphDelta(['internal1.md', 'internal2.md'], graph)

        // Find the updated external node
        const updatedExternal: GraphDelta[number] | undefined = result.find(
            (d) => d.type === 'UpsertNode' &&
                   (d as { nodeToUpsert: GraphNode }).nodeToUpsert.relativeFilePathIsID === 'external.md'
        )

        expect(updatedExternal).toBeDefined()
        if (updatedExternal && updatedExternal.type === 'UpsertNode') {
            // Both edges should now point to the same representative
            expect(updatedExternal.nodeToUpsert.outgoingEdges).toHaveLength(2)
            const targets: readonly string[] = updatedExternal.nodeToUpsert.outgoingEdges.map((e) => e.targetId)
            // Both should point to the same merged node
            expect(targets[0]).toMatch(/^VT\/merged_/)
            expect(targets[0]).toBe(targets[1])
        }
    })

    it('should discard internal edges between selected nodes', () => {
        const graph: Graph = {
            nodes: {
                'node1.md': createNode('node1.md', [createEdge('node2.md', 'internal')], { x: 0, y: 0 }),
                'node2.md': createNode('node2.md', [], { x: 100, y: 100 })
            }
        }

        const result: GraphDelta = computeMergeGraphDelta(['node1.md', 'node2.md'], graph)

        // Should only have 3 deltas: 1 representative + 2 deletes
        // No external node updates because there are no external nodes
        expect(result).toHaveLength(3)

        // Representative should have no outgoing edges
        if (result[0].type === 'UpsertNode') {
            expect(result[0].nodeToUpsert.outgoingEdges).toHaveLength(0)
        }
    })
})
