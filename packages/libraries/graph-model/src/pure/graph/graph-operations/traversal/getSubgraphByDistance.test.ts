import { describe, it, expect } from 'vitest'
import { getSubgraphByDistance, getUnionSubgraphByDistance } from './getSubgraphByDistance'
import type { Graph, GraphNode, Edge } from '../..'
import { createGraph, createEmptyGraph } from '../../construction/createGraph'
import * as O from 'fp-ts/lib/Option.js'

const createTestNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    kind: 'leaf',
    absoluteFilePathIsID: id,
    outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
      isContextNode: false
    }
})

const toEdges: (ids: readonly string[]) => readonly { readonly targetId: string; readonly label: string; }[] = (ids: readonly string[]) => ids.map(targetId => ({ targetId, label: '' }))

describe('getSubgraphByDistance', () => {
  describe('basic functionality', () => {
    it('should return only the start node when no neighbors within distance', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes)).toEqual(['A'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should include direct child within distance threshold', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should include direct parent within distance threshold', () => {
      const graph: Graph = createGraph({
        'Parent': createTestNode('Parent', ['A']),
        'A': createTestNode('A', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'Parent'])
      expect(result.nodes['Parent'].outgoingEdges).toEqual(toEdges(['A']))
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })
  })

  describe('weighted distance costs', () => {
    it('should apply cost 1.5 for outgoing edges (children)', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', ['E']),
        'E': createTestNode('E', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('should exclude nodes beyond distance threshold on outgoing edges', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', ['E']),
        'E': createTestNode('E', ['F']),
        'F': createTestNode('F', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('should apply cost 1.0 for incoming edges (parents)', () => {
      const graph: Graph = createGraph({
        'E': createTestNode('E', ['D']),
        'D': createTestNode('D', ['C']),
        'C': createTestNode('C', ['B']),
        'B': createTestNode('B', ['A']),
        'A': createTestNode('A', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 5)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('should exclude parent nodes beyond distance threshold', () => {
      const graph: Graph = createGraph({
        'P6': createTestNode('P6', ['P5']),
        'P5': createTestNode('P5', ['P4']),
        'P4': createTestNode('P4', ['P3']),
        'P3': createTestNode('P3', ['P2']),
        'P2': createTestNode('P2', ['P1']),
        'P1': createTestNode('P1', ['A']),
        'A': createTestNode('A', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 5)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'P1', 'P2', 'P3', 'P4'])
    })

    it('should respect different costs for parents vs children', () => {
      const graph: Graph = createGraph({
        'Parent': createTestNode('Parent', ['A']),
        'A': createTestNode('A', ['Child']),
        'Child': createTestNode('Child', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 2)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'Child', 'Parent'])
    })
  })

  describe('complex graph topologies', () => {
    it('should handle star topology with mixed edge types', () => {
      const graph: Graph = createGraph({
        'P1': createTestNode('P1', ['Center']),
        'P2': createTestNode('P2', ['Center']),
        'Center': createTestNode('Center', ['C1', 'C2']),
        'C1': createTestNode('C1', []),
        'C2': createTestNode('C2', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'Center', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['C1', 'C2', 'Center', 'P1', 'P2'])
    })

    it('should handle diamond topology', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', ['D']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['D']))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['D']))
    })

    it('should handle bidirectional graph', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['A'])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['A']))
    })

    it('should handle cyclic graph without infinite loop', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', ['A'])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
    })
  })

  describe('edge filtering', () => {
    it('should filter out edges where target is not in visited set', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 2)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should preserve edges when both endpoints are in visited set', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['C']))
    })
  })

  describe('edge cases', () => {
    it('should handle empty graph', () => {
      const graph: Graph = createEmptyGraph()

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(result.nodes).toEqual({})
    })

    it('should handle start node that does not exist in graph', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'NonExistent', 7)

      expect(result.nodes).toEqual({})
    })

    it('should handle maxDistance of 0', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 0)

      expect(Object.keys(result.nodes)).toEqual(['A'])
    })

    it('should not mutate the original graph', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const originalAEdges: readonly Edge[] = [...graph.nodes['A'].outgoingEdges]
      const originalBEdges: readonly Edge[] = [...graph.nodes['B'].outgoingEdges]

      getSubgraphByDistance(graph, 'A', 7)

      expect(graph.nodes['A'].outgoingEdges).toEqual(originalAEdges)
      expect(graph.nodes['B'].outgoingEdges).toEqual(originalBEdges)
    })

    it('should preserve node properties other than outgoingEdges', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(result.nodes['A'].absoluteFilePathIsID).toBe('A')
      expect(result.nodes['A'].contentWithoutYamlOrLinks).toBe('content of A')
      expect(result.nodes['A'].nodeUIMetadata).toEqual(graph.nodes['A'].nodeUIMetadata)
    })
  })
})

describe('getUnionSubgraphByDistance', () => {
  it('should merge subgraphs from multiple starting nodes', () => {
    const graph: Graph = createGraph({
      'A': createTestNode('A', ['B']),
      'B': createTestNode('B', []),
      'C': createTestNode('C', ['D']),
      'D': createTestNode('D', [])
    })

    const result: Graph = getUnionSubgraphByDistance(graph, ['A', 'C'], 7)

    expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('should handle empty start node list', () => {
    const graph: Graph = createGraph({
      'A': createTestNode('A', [])
    })

    const result: Graph = getUnionSubgraphByDistance(graph, [], 7)

    expect(Object.keys(result.nodes)).toEqual([])
  })

  it('should skip non-existent start nodes', () => {
    const graph: Graph = createGraph({
      'A': createTestNode('A', ['B']),
      'B': createTestNode('B', [])
    })

    const result: Graph = getUnionSubgraphByDistance(graph, ['NonExistent', 'A'], 7)

    expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
  })
})
