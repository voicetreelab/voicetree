import { describe, it, expect } from 'vitest'
import { getIncomingEdgesToSubgraph } from '@/pure/graph/graph-operations/merge/getIncomingEdgesToSubgraph'
import type { Graph, NodeIdAndFilePath, GraphNode, Edge } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

// Helper to create a minimal GraphNode
function createNode(
  id: NodeIdAndFilePath,
  outgoingEdges: readonly Edge[] = []
): GraphNode {
  return {
    relativeFilePathIsID: id,
    outgoingEdges,
    contentWithoutYamlOrLinks: '',
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map()
    }
  }
}

// Helper to create an edge
function createEdge(targetId: NodeIdAndFilePath, label = ''): Edge {
  return { targetId, label }
}

describe('getIncomingEdgesToSubgraph', () => {
  it('should return edge from external node into subgraph', () => {
    const graph: Graph = {
      nodes: {
        'external.md': createNode('external.md', [
          createEdge('internal.md', 'link to internal')
        ]),
        'internal.md': createNode('internal.md')
      }
    }

    const result = getIncomingEdgesToSubgraph(['internal.md'], graph)

    expect(result).toEqual([
      {
        sourceNodeId: 'external.md',
        edge: { targetId: 'internal.md', label: 'link to internal' }
      }
    ])
  })

  it('should NOT return internal edges between subgraph nodes', () => {
    const graph: Graph = {
      nodes: {
        'node1.md': createNode('node1.md', [
          createEdge('node2.md', 'internal link')
        ]),
        'node2.md': createNode('node2.md')
      }
    }

    const result = getIncomingEdgesToSubgraph(['node1.md', 'node2.md'], graph)

    expect(result).toEqual([])
  })

  it('should NOT return edges from external node that do not point to subgraph', () => {
    const graph: Graph = {
      nodes: {
        'external.md': createNode('external.md', [
          createEdge('other-external.md', 'external link')
        ]),
        'other-external.md': createNode('other-external.md'),
        'internal.md': createNode('internal.md')
      }
    }

    const result = getIncomingEdgesToSubgraph(['internal.md'], graph)

    expect(result).toEqual([])
  })

  it('should return multiple edges from multiple external nodes', () => {
    const graph: Graph = {
      nodes: {
        'external1.md': createNode('external1.md', [
          createEdge('internal1.md', 'link from ext1')
        ]),
        'external2.md': createNode('external2.md', [
          createEdge('internal2.md', 'link from ext2')
        ]),
        'internal1.md': createNode('internal1.md'),
        'internal2.md': createNode('internal2.md')
      }
    }

    const result = getIncomingEdgesToSubgraph(
      ['internal1.md', 'internal2.md'],
      graph
    )

    expect(result).toHaveLength(2)
    expect(result).toContainEqual({
      sourceNodeId: 'external1.md',
      edge: { targetId: 'internal1.md', label: 'link from ext1' }
    })
    expect(result).toContainEqual({
      sourceNodeId: 'external2.md',
      edge: { targetId: 'internal2.md', label: 'link from ext2' }
    })
  })

  it('should return multiple edges from same external node', () => {
    const graph: Graph = {
      nodes: {
        'external.md': createNode('external.md', [
          createEdge('internal1.md', 'link 1'),
          createEdge('internal2.md', 'link 2')
        ]),
        'internal1.md': createNode('internal1.md'),
        'internal2.md': createNode('internal2.md')
      }
    }

    const result = getIncomingEdgesToSubgraph(
      ['internal1.md', 'internal2.md'],
      graph
    )

    expect(result).toHaveLength(2)
    expect(result).toContainEqual({
      sourceNodeId: 'external.md',
      edge: { targetId: 'internal1.md', label: 'link 1' }
    })
    expect(result).toContainEqual({
      sourceNodeId: 'external.md',
      edge: { targetId: 'internal2.md', label: 'link 2' }
    })
  })

  it('should return empty array for empty subgraph', () => {
    const graph: Graph = {
      nodes: {
        'node1.md': createNode('node1.md', [createEdge('node2.md')])
      }
    }

    const result = getIncomingEdgesToSubgraph([], graph)

    expect(result).toEqual([])
  })

  it('should return empty array when subgraph has no incoming edges', () => {
    const graph: Graph = {
      nodes: {
        'external.md': createNode('external.md'),
        'internal.md': createNode('internal.md', [
          createEdge('external.md', 'outgoing edge')
        ])
      }
    }

    const result = getIncomingEdgesToSubgraph(['internal.md'], graph)

    expect(result).toEqual([])
  })

  it('should handle mixed scenario with both incoming and outgoing edges', () => {
    const graph: Graph = {
      nodes: {
        'external1.md': createNode('external1.md', [
          createEdge('internal.md', 'incoming edge')
        ]),
        'external2.md': createNode('external2.md'),
        'internal.md': createNode('internal.md', [
          createEdge('external2.md', 'outgoing edge')
        ])
      }
    }

    const result = getIncomingEdgesToSubgraph(['internal.md'], graph)

    expect(result).toEqual([
      {
        sourceNodeId: 'external1.md',
        edge: { targetId: 'internal.md', label: 'incoming edge' }
      }
    ])
  })
})
