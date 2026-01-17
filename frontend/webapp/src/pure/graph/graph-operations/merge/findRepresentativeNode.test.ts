import { describe, it, expect } from 'vitest'
import { findRepresentativeNode } from './findRepresentativeNode'
import type { Graph, GraphNode, Edge, NodeIdAndFilePath } from '@/pure/graph'
import { createGraph } from '@/pure/graph/createGraph'
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

describe('findRepresentativeNode', () => {
    it('should return the node with most reachable nodes within subgraph', () => {
        // Subgraph: nodeA -> nodeB -> nodeC
        // nodeA can reach 2 nodes (B and C), nodeB can reach 1 (C), nodeC can reach 0
        // nodeA should be chosen as representative
        const graph: Graph = createGraph({
            'nodeA.md': createNode('nodeA.md', [createEdge('nodeB.md')], '# Node A'),
            'nodeB.md': createNode('nodeB.md', [createEdge('nodeC.md')], '# Node B'),
            'nodeC.md': createNode('nodeC.md', [], '# Node C')
        })

        const result: NodeIdAndFilePath | undefined = findRepresentativeNode(['nodeA.md', 'nodeB.md', 'nodeC.md'], graph)

        expect(result).toBe('nodeA.md')
    })

    it('should return first node alphabetically when all have same reachable count', () => {
        // Subgraph: nodeA, nodeB, nodeC (no edges between them)
        // All can reach 0 nodes, so pick alphabetically first
        const graph: Graph = createGraph({
            'nodeB.md': createNode('nodeB.md', [], '# Node B'),
            'nodeA.md': createNode('nodeA.md', [], '# Node A'),
            'nodeC.md': createNode('nodeC.md', [], '# Node C')
        })

        const result: NodeIdAndFilePath | undefined = findRepresentativeNode(['nodeA.md', 'nodeB.md', 'nodeC.md'], graph)

        expect(result).toBe('nodeA.md')
    })

    it('should only count reachable nodes within the subgraph, not external nodes', () => {
        // nodeA -> nodeB -> external (external not in subgraph)
        // nodeA can reach 1 node in subgraph (nodeB), not counting external
        // nodeB can reach 0 nodes in subgraph (external doesn't count)
        // nodeA should be chosen
        const graph: Graph = createGraph({
            'nodeA.md': createNode('nodeA.md', [createEdge('nodeB.md')], '# Node A'),
            'nodeB.md': createNode('nodeB.md', [createEdge('external.md')], '# Node B'),
            'external.md': createNode('external.md', [], '# External')
        })

        const result: NodeIdAndFilePath | undefined = findRepresentativeNode(['nodeA.md', 'nodeB.md'], graph)

        expect(result).toBe('nodeA.md')
    })

    it('should handle deep chains within subgraph', () => {
        // Subgraph: a -> b -> c -> d -> e
        // a can reach 4 nodes (b, c, d, e)
        const graph: Graph = createGraph({
            'a.md': createNode('a.md', [createEdge('b.md')], '# A'),
            'b.md': createNode('b.md', [createEdge('c.md')], '# B'),
            'c.md': createNode('c.md', [createEdge('d.md')], '# C'),
            'd.md': createNode('d.md', [createEdge('e.md')], '# D'),
            'e.md': createNode('e.md', [], '# E')
        })

        const result: NodeIdAndFilePath | undefined = findRepresentativeNode(['a.md', 'b.md', 'c.md', 'd.md', 'e.md'], graph)

        expect(result).toBe('a.md')
    })

    it('should return undefined for empty subgraph', () => {
        const graph: Graph = createGraph({})

        const result: NodeIdAndFilePath | undefined = findRepresentativeNode([], graph)

        expect(result).toBeUndefined()
    })

    it('should handle branching structures and pick node with most reachable', () => {
        // Subgraph:
        //   nodeA -> nodeB
        //   nodeA -> nodeC -> nodeD
        // nodeA can reach 3 nodes (B, C, D)
        // nodeC can reach 1 node (D)
        // nodeB and nodeD can reach 0 nodes
        // nodeA should be chosen
        const graph: Graph = createGraph({
            'nodeA.md': createNode('nodeA.md', [createEdge('nodeB.md'), createEdge('nodeC.md')], '# Node A'),
            'nodeB.md': createNode('nodeB.md', [], '# Node B'),
            'nodeC.md': createNode('nodeC.md', [createEdge('nodeD.md')], '# Node C'),
            'nodeD.md': createNode('nodeD.md', [], '# Node D')
        })

        const result: NodeIdAndFilePath | undefined = findRepresentativeNode(['nodeA.md', 'nodeB.md', 'nodeC.md', 'nodeD.md'], graph)

        expect(result).toBe('nodeA.md')
    })
})
