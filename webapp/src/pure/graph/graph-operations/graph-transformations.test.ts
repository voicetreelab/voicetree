import { describe, it, expect } from 'vitest'
import { reverseGraphEdges, makeBidirectionalEdges } from '@/pure/graph/graph-operations/graph-transformations'
import type { Graph, GraphNode, Edge } from '@/pure/graph'
import { createGraph, createEmptyGraph } from '@/pure/graph/createGraph'
import * as O from 'fp-ts/lib/Option.js'

describe('graph-transformations', () => {
  const createTestNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    absoluteFilePathIsID: id,
    outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,

      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  // Helper to convert string arrays to Edge arrays for assertions
  const toEdges: (ids: readonly string[]) => readonly { readonly targetId: string; readonly label: string; }[] = (ids: readonly string[]) => ids.map(targetId => ({ targetId, label: '' }))

  describe('reverseGraphEdges', () => {
    it('should reverse edges in a simple chain A -> B -> C', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = reverseGraphEdges(graph)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['A']))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should reverse edges in a graph with multiple incoming edges', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['C']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = reverseGraphEdges(graph)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges([]))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['A', 'B']))
    })

    it('should reverse edges in a graph with multiple outgoing edges', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', []),
        'C': createTestNode('C', [])
      })

      const result: Graph = reverseGraphEdges(graph)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['A']))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['A']))
    })

    it('should handle empty graph', () => {
      const graph: Graph = createEmptyGraph()

      const result: Graph = reverseGraphEdges(graph)

      expect(result.nodes).toEqual({})
    })

    it('should handle graph with single node and no edges', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', [])
      })

      const result: Graph = reverseGraphEdges(graph)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should handle cyclic graph A -> B -> A', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['A'])
      })

      const result: Graph = reverseGraphEdges(graph)

      // Edges should still form a cycle but reversed
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['A']))
    })

    it('should not mutate the original graph', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const originalAEdges: readonly Edge[] = [...graph.nodes['A'].outgoingEdges]
      const originalBEdges: readonly Edge[] = [...graph.nodes['B'].outgoingEdges]

      reverseGraphEdges(graph)

      expect(graph.nodes['A'].outgoingEdges).toEqual(originalAEdges)
      expect(graph.nodes['B'].outgoingEdges).toEqual(originalBEdges)
    })

    it('should preserve node properties other than outgoingEdges', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = reverseGraphEdges(graph)

      expect(result.nodes['A'].absoluteFilePathIsID).toBe('A')
      expect(result.nodes['A'].contentWithoutYamlOrLinks).toBe('content of A')
      expect(result.nodes['A'].nodeUIMetadata).toEqual(graph.nodes['A'].nodeUIMetadata)

      expect(result.nodes['B'].absoluteFilePathIsID).toBe('B')
      expect(result.nodes['B'].contentWithoutYamlOrLinks).toBe('content of B')
      expect(result.nodes['B'].nodeUIMetadata).toEqual(graph.nodes['B'].nodeUIMetadata)
    })

    it('should handle complex diamond graph', () => {
      // A -> B -> D
      // A -> C -> D
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', ['D']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', [])
      })

      const result: Graph = reverseGraphEdges(graph)

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
      const graph: Graph = createGraph({
        'source': createTestNode('source', ['does-not-exist'])
      })

      // First reversal: edges to non-existent nodes are preserved
      const reversed1: Graph = reverseGraphEdges(graph)
      expect(reversed1.nodes['source'].outgoingEdges).toEqual(toEdges(['does-not-exist']))

      // Second reversal: still preserved (idempotent for non-existent edges)
      const reversed2: Graph = reverseGraphEdges(reversed1)
      expect(reversed2.nodes['source'].outgoingEdges).toEqual(toEdges(['does-not-exist']))
    })
  })

  describe('makeBidirectionalEdges', () => {
    it('should make edges bidirectional in a simple chain A -> B -> C', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = makeBidirectionalEdges(graph)

      // A -> B becomes A <-> B
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(expect.arrayContaining([...toEdges(['C', 'A'])]))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should not duplicate already bidirectional edges', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['A'])
      })

      const result: Graph = makeBidirectionalEdges(graph)

      // Already bidirectional, should not add duplicates
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['A']))
    })

    it('should handle graph where start node has only parents (the bug case)', () => {
      // This is the exact scenario that caused the ASCII tree bug:
      // Start node C has parents (A, B point to C) but no children
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['C']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = makeBidirectionalEdges(graph)

      // C should now have edges to A and B (its parents become "children" for tree viz)
      expect(result.nodes['C'].outgoingEdges).toEqual(expect.arrayContaining([...toEdges(['A', 'B'])]))
      // A and B keep their original edges to C
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['C']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['C']))
    })

    it('should handle empty graph', () => {
      const graph: Graph = createEmptyGraph()

      const result: Graph = makeBidirectionalEdges(graph)

      expect(result.nodes).toEqual({})
    })

    it('should not mutate the original graph', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const originalAEdges: readonly Edge[] = [...graph.nodes['A'].outgoingEdges]
      const originalBEdges: readonly Edge[] = [...graph.nodes['B'].outgoingEdges]

      makeBidirectionalEdges(graph)

      expect(graph.nodes['A'].outgoingEdges).toEqual(originalAEdges)
      expect(graph.nodes['B'].outgoingEdges).toEqual(originalBEdges)
    })
  })
})
