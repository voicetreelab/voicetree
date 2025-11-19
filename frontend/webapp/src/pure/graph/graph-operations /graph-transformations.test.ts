import { describe, it, expect } from 'vitest'
import { reverseGraphEdges } from '@/pure/graph/graph-operations /graph-transformations.ts'
import type { Graph, GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

describe('graph-transformations', () => {
  const createTestNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    relativeFilePathIsID: id,
    outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
    content: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      title: id
    }
  })

  // Helper to convert string arrays to Edge arrays for assertions
  const toEdges = (ids: readonly string[]) => ids.map(targetId => ({ targetId, label: '' }))

  describe('reverseGraphEdges', () => {
    it('should reverse edges in a simple chain A -> B -> C', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', ['C']),
          'C': createTestNode('C', [])
        }
      }

      const result = reverseGraphEdges(graph)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['A']))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should reverse edges in a graph with multiple incoming edges', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['C']),
          'B': createTestNode('B', ['C']),
          'C': createTestNode('C', [])
        }
      }

      const result = reverseGraphEdges(graph)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges([]))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['A', 'B']))
    })

    it('should reverse edges in a graph with multiple outgoing edges', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B', 'C']),
          'B': createTestNode('B', []),
          'C': createTestNode('C', [])
        }
      }

      const result = reverseGraphEdges(graph)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['A']))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['A']))
    })

    it('should handle empty graph', () => {
      const graph: Graph = {
        nodes: {}
      }

      const result = reverseGraphEdges(graph)

      expect(result.nodes).toEqual({})
    })

    it('should handle graph with single node and no edges', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', [])
        }
      }

      const result = reverseGraphEdges(graph)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should handle cyclic graph A -> B -> A', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', ['A'])
        }
      }

      const result = reverseGraphEdges(graph)

      // Edges should still form a cycle but reversed
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['A']))
    })

    it('should not mutate the original graph', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', [])
        }
      }

      const originalAEdges = [...graph.nodes['A'].outgoingEdges]
      const originalBEdges = [...graph.nodes['B'].outgoingEdges]

      reverseGraphEdges(graph)

      expect(graph.nodes['A'].outgoingEdges).toEqual(originalAEdges)
      expect(graph.nodes['B'].outgoingEdges).toEqual(originalBEdges)
    })

    it('should preserve node properties other than outgoingEdges', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', [])
        }
      }

      const result = reverseGraphEdges(graph)

      expect(result.nodes['A'].relativeFilePathIsID).toBe('A')
      expect(result.nodes['A'].content).toBe('content of A')
      expect(result.nodes['A'].nodeUIMetadata).toEqual(graph.nodes['A'].nodeUIMetadata)

      expect(result.nodes['B'].relativeFilePathIsID).toBe('B')
      expect(result.nodes['B'].content).toBe('content of B')
      expect(result.nodes['B'].nodeUIMetadata).toEqual(graph.nodes['B'].nodeUIMetadata)
    })

    it('should handle complex diamond graph', () => {
      // A -> B -> D
      // A -> C -> D
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B', 'C']),
          'B': createTestNode('B', ['D']),
          'C': createTestNode('C', ['D']),
          'D': createTestNode('D', [])
        }
      }

      const result = reverseGraphEdges(graph)

      // Should become:
      // D -> B -> A
      // D -> C -> A
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['A']))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['A']))
      expect(result.nodes['D'].outgoingEdges).toEqual(toEdges(['B', 'C']))
    })

    it('should preserve edges to non-existent nodes after double reversal', () => {
      // Edges to non-existent nodes should be preserved through reversals
      const graph: Graph = {
        nodes: {
          'source': createTestNode('source', ['does-not-exist'])
        }
      }

      // First reversal: edges to non-existent nodes are preserved
      const reversed1 = reverseGraphEdges(graph)
      expect(reversed1.nodes['source'].outgoingEdges).toEqual(toEdges(['does-not-exist']))

      // Second reversal: still preserved (idempotent for non-existent edges)
      const reversed2 = reverseGraphEdges(reversed1)
      expect(reversed2.nodes['source'].outgoingEdges).toEqual(toEdges(['does-not-exist']))
    })
  })
})
