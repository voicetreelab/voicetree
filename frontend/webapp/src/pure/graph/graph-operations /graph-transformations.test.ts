import { describe, it, expect } from 'vitest'
import { reverseGraphEdges } from '@/pure/graph/graph-operations /graph-transformations.ts'
import type { Graph, GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

describe('graph-transformations', () => {
  const createTestNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    relativeFilePathIsID: id,
    outgoingEdges: edges,
    content: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none
    }
  })

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

      expect(result.nodes['A'].outgoingEdges).toEqual([])
      expect(result.nodes['B'].outgoingEdges).toEqual(['A'])
      expect(result.nodes['C'].outgoingEdges).toEqual(['B'])
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

      expect(result.nodes['A'].outgoingEdges).toEqual([])
      expect(result.nodes['B'].outgoingEdges).toEqual([])
      expect(result.nodes['C'].outgoingEdges).toEqual(['A', 'B'])
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

      expect(result.nodes['A'].outgoingEdges).toEqual([])
      expect(result.nodes['B'].outgoingEdges).toEqual(['A'])
      expect(result.nodes['C'].outgoingEdges).toEqual(['A'])
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

      expect(result.nodes['A'].outgoingEdges).toEqual([])
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
      expect(result.nodes['A'].outgoingEdges).toEqual(['B'])
      expect(result.nodes['B'].outgoingEdges).toEqual(['A'])
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
      expect(result.nodes['A'].outgoingEdges).toEqual([])
      expect(result.nodes['B'].outgoingEdges).toEqual(['A'])
      expect(result.nodes['C'].outgoingEdges).toEqual(['A'])
      expect(result.nodes['D'].outgoingEdges).toEqual(['B', 'C'])
    })
  })
})
