import { describe, it, expect } from 'vitest'
import { getSubgraphByDistance } from '@/pure/graph/graph-operations /traversal/getSubgraphByDistance'
import type { Graph, GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

describe('getSubgraphByDistance', () => {
  const createTestNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    relativeFilePathIsID: id,
    outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      title: id,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  const toEdges: (ids: readonly string[]) => { targetId: string; label: string; }[] = (ids: readonly string[]) => ids.map(targetId => ({ targetId, label: '' }))

  describe('basic functionality', () => {
    it('should return only the start node when no neighbors within distance', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes)).toEqual(['A'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should include direct child within distance threshold', () => {
      // A -> B (cost 1.5, within threshold of 7)
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should include direct parent within distance threshold', () => {
      // Parent -> A (start from A, should find Parent with cost 1.0)
      const graph: Graph = {
        nodes: {
          'Parent': createTestNode('Parent', ['A']),
          'A': createTestNode('A', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'Parent'])
      expect(result.nodes['Parent'].outgoingEdges).toEqual(toEdges(['A']))
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })
  })

  describe('weighted distance costs', () => {
    it('should apply cost 1.5 for outgoing edges (children)', () => {
      // A -> B -> C -> D -> E (costs: 1.5, 3.0, 4.5, 6.0)
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', ['C']),
          'C': createTestNode('C', ['D']),
          'D': createTestNode('D', ['E']),
          'E': createTestNode('E', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // Should include A, B (1.5), C (3.0), D (4.5), E (6.0) - all under 7
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('should exclude nodes beyond distance threshold on outgoing edges', () => {
      // A -> B -> C -> D -> E -> F (costs: 1.5, 3.0, 4.5, 6.0, 7.5)
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', ['C']),
          'C': createTestNode('C', ['D']),
          'D': createTestNode('D', ['E']),
          'E': createTestNode('E', ['F']),
          'F': createTestNode('F', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // Should include A, B (1.5), C (3.0), D (4.5), E (6.0)
      // Should NOT include F (7.5 >= 7)
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('should apply cost 1.0 for incoming edges (parents)', () => {
      // E -> D -> C -> B -> A (start from A, traverse parents with cost 1.0)
      const graph: Graph = {
        nodes: {
          'E': createTestNode('E', ['D']),
          'D': createTestNode('D', ['C']),
          'C': createTestNode('C', ['B']),
          'B': createTestNode('B', ['A']),
          'A': createTestNode('A', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 5)

      // Should include A, B (1.0), C (2.0), D (3.0), E (4.0) - all under 5
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('should exclude parent nodes beyond distance threshold', () => {
      // Many parents -> ... -> A
      const graph: Graph = {
        nodes: {
          'P6': createTestNode('P6', ['P5']),
          'P5': createTestNode('P5', ['P4']),
          'P4': createTestNode('P4', ['P3']),
          'P3': createTestNode('P3', ['P2']),
          'P2': createTestNode('P2', ['P1']),
          'P1': createTestNode('P1', ['A']),
          'A': createTestNode('A', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 5)

      // Should include A, P1 (1.0), P2 (2.0), P3 (3.0), P4 (4.0)
      // Should NOT include P5 (5.0 >= 5), P6 (6.0 >= 5)
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'P1', 'P2', 'P3', 'P4'])
    })

    it('should respect different costs for parents vs children', () => {
      // Parent -> A -> Child
      // From A: Parent costs 1.0, Child costs 1.5
      const graph: Graph = {
        nodes: {
          'Parent': createTestNode('Parent', ['A']),
          'A': createTestNode('A', ['Child']),
          'Child': createTestNode('Child', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 2)

      // Should include A (0), Parent (1.0), Child (1.5)
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'Child', 'Parent'])
    })
  })

  describe('complex graph topologies', () => {
    it('should handle star topology with mixed edge types', () => {
      // Central node with multiple children and parents
      const graph: Graph = {
        nodes: {
          'P1': createTestNode('P1', ['Center']),
          'P2': createTestNode('P2', ['Center']),
          'Center': createTestNode('Center', ['C1', 'C2']),
          'C1': createTestNode('C1', []),
          'C2': createTestNode('C2', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'Center', 7)

      // Should include all nodes: Center, parents (1.0 each), children (1.5 each)
      expect(Object.keys(result.nodes).sort()).toEqual(['C1', 'C2', 'Center', 'P1', 'P2'])
    })

    it('should handle diamond topology', () => {
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

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // All nodes should be included
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
      // D should have edges from both B and C
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['D']))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['D']))
    })

    it('should handle bidirectional graph', () => {
      // A <-> B (mutual edges)
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', ['A'])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['A']))
    })

    it('should handle cyclic graph without infinite loop', () => {
      // A -> B -> C -> A (cycle)
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', ['C']),
          'C': createTestNode('C', ['A'])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // Should visit all nodes in cycle exactly once
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
    })
  })

  describe('edge filtering', () => {
    it('should filter out edges where target is not in visited set', () => {
      // A -> B -> C
      // Start from A with maxDistance = 2 (only includes A and B)
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', ['C']),
          'C': createTestNode('C', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 2)

      // Only A and B should be included (C at distance 3.0 >= 2)
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      // B's edge to C should be filtered out since C is not in result
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should preserve edges when both endpoints are in visited set', () => {
      // A -> B -> C
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', ['C']),
          'C': createTestNode('C', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // All nodes included, all edges preserved
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['C']))
    })
  })

  describe('edge cases', () => {
    it('should handle empty graph', () => {
      const graph: Graph = {
        nodes: {}
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(result.nodes).toEqual({})
    })

    it('should handle start node that does not exist in graph', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'NonExistent', 7)

      expect(result.nodes).toEqual({})
    })

    it('should handle maxDistance of 0', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', [])
        }
      }

      const result: Graph = getSubgraphByDistance(graph, 'A', 0)

      // Only start node at distance 0
      expect(Object.keys(result.nodes)).toEqual(['A'])
    })

    it('should not mutate the original graph', () => {
      const graph: Graph = {
        nodes: {
          'A': createTestNode('A', ['B']),
          'B': createTestNode('B', [])
        }
      }

      const originalAEdges: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Edge[] = [...graph.nodes['A'].outgoingEdges]
      const originalBEdges: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").Edge[] = [...graph.nodes['B'].outgoingEdges]

      getSubgraphByDistance(graph, 'A', 7)

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

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(result.nodes['A'].relativeFilePathIsID).toBe('A')
      expect(result.nodes['A'].contentWithoutYamlOrLinks).toBe('content of A')
      expect(result.nodes['A'].nodeUIMetadata).toEqual(graph.nodes['A'].nodeUIMetadata)
    })
  })
})
