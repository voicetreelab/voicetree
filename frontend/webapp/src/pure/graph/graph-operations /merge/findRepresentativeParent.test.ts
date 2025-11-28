import { describe, it, expect } from 'vitest'
import { findRepresentativeParent } from './findRepresentativeParent'
import type { Graph, GraphNode, Edge } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

// Helper to create a minimal GraphNode
function createNode(
    id: string,
    outgoingEdges: readonly Edge[] = [],
    content = '# Node'
): GraphNode {
    return {
        relativeFilePathIsID: id,
        outgoingEdges,
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map()
        }
    }
}

// Helper to create an edge
function createEdge(targetId: string, label = ''): Edge {
    return { targetId, label }
}

describe('findRepresentativeParent', () => {
    it('should return the node with most ancestors within subgraph', () => {
        // Subgraph: nodeA -> nodeB -> nodeC
        // nodeC has 2 ancestors (A and B), nodeB has 1 (A), nodeA has 0
        // nodeC should be chosen as representative
        const graph: Graph = {
            nodes: {
                'nodeA.md': createNode('nodeA.md', [createEdge('nodeB.md')], '# Node A'),
                'nodeB.md': createNode('nodeB.md', [createEdge('nodeC.md')], '# Node B'),
                'nodeC.md': createNode('nodeC.md', [], '# Node C')
            }
        }

        const result = findRepresentativeParent(['nodeA.md', 'nodeB.md', 'nodeC.md'], graph)

        expect(result).toBe('nodeC.md')
    })

    it('should return first node alphabetically when all have same ancestor count', () => {
        // Subgraph: nodeA, nodeB, nodeC (no edges between them)
        // All have 0 ancestors, so pick alphabetically first
        const graph: Graph = {
            nodes: {
                'nodeB.md': createNode('nodeB.md', [], '# Node B'),
                'nodeA.md': createNode('nodeA.md', [], '# Node A'),
                'nodeC.md': createNode('nodeC.md', [], '# Node C')
            }
        }

        const result = findRepresentativeParent(['nodeA.md', 'nodeB.md', 'nodeC.md'], graph)

        expect(result).toBe('nodeA.md')
    })

    it('should only count ancestors within the subgraph, not external nodes', () => {
        // external -> nodeA -> nodeB (external not in subgraph)
        // nodeA has 0 ancestors in subgraph (external doesn't count)
        // nodeB has 1 ancestor in subgraph (nodeA)
        // nodeB should be chosen
        const graph: Graph = {
            nodes: {
                'external.md': createNode('external.md', [createEdge('nodeA.md')], '# External'),
                'nodeA.md': createNode('nodeA.md', [createEdge('nodeB.md')], '# Node A'),
                'nodeB.md': createNode('nodeB.md', [], '# Node B')
            }
        }

        const result = findRepresentativeParent(['nodeA.md', 'nodeB.md'], graph)

        expect(result).toBe('nodeB.md')
    })

    it('should handle deep chains within subgraph', () => {
        // Subgraph: a -> b -> c -> d -> e
        // e has 4 ancestors (a, b, c, d)
        const graph: Graph = {
            nodes: {
                'a.md': createNode('a.md', [createEdge('b.md')], '# A'),
                'b.md': createNode('b.md', [createEdge('c.md')], '# B'),
                'c.md': createNode('c.md', [createEdge('d.md')], '# C'),
                'd.md': createNode('d.md', [createEdge('e.md')], '# D'),
                'e.md': createNode('e.md', [], '# E')
            }
        }

        const result = findRepresentativeParent(['a.md', 'b.md', 'c.md', 'd.md', 'e.md'], graph)

        expect(result).toBe('e.md')
    })

    it('should return undefined for empty subgraph', () => {
        const graph: Graph = { nodes: {} }

        const result = findRepresentativeParent([], graph)

        expect(result).toBeUndefined()
    })

    it('should handle branching structures and pick deepest node', () => {
        // Subgraph:
        //   nodeA -> nodeB
        //   nodeA -> nodeC -> nodeD
        // nodeB has 1 ancestor (A)
        // nodeD has 2 ancestors (A, C)
        // nodeD should be chosen
        const graph: Graph = {
            nodes: {
                'nodeA.md': createNode('nodeA.md', [createEdge('nodeB.md'), createEdge('nodeC.md')], '# Node A'),
                'nodeB.md': createNode('nodeB.md', [], '# Node B'),
                'nodeC.md': createNode('nodeC.md', [createEdge('nodeD.md')], '# Node C'),
                'nodeD.md': createNode('nodeD.md', [], '# Node D')
            }
        }

        const result = findRepresentativeParent(['nodeA.md', 'nodeB.md', 'nodeC.md', 'nodeD.md'], graph)

        expect(result).toBe('nodeD.md')
    })
})
