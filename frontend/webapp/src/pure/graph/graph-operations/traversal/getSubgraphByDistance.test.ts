import { describe, it, expect } from 'vitest'
import { getSubgraphByDistance, getUnionSubgraphByDistance } from '@/pure/graph/graph-operations/traversal/getSubgraphByDistance'
import type { Graph, GraphNode, Edge } from '@/pure/graph'
import { createGraph, createEmptyGraph } from '@/pure/graph/createGraph'
import * as O from 'fp-ts/lib/Option.js'

describe('getSubgraphByDistance', () => {
  const createTestNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    relativeFilePathIsID: id,
    outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,

      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  const toEdges: (ids: readonly string[]) => readonly { readonly targetId: string; readonly label: string; }[] = (ids: readonly string[]) => ids.map(targetId => ({ targetId, label: '' }))

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
      // A -> B (cost 1.5, within threshold of 7)
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
      // Parent -> A (start from A, should find Parent with cost 1.0)
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
      // A -> B -> C -> D -> E (costs: 1.5, 3.0, 4.5, 6.0)
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', ['E']),
        'E': createTestNode('E', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // Should include A, B (1.5), C (3.0), D (4.5), E (6.0) - all under 7
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('should exclude nodes beyond distance threshold on outgoing edges', () => {
      // A -> B -> C -> D -> E -> F (costs: 1.5, 3.0, 4.5, 6.0, 7.5)
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', ['E']),
        'E': createTestNode('E', ['F']),
        'F': createTestNode('F', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // Should include A, B (1.5), C (3.0), D (4.5), E (6.0)
      // Should NOT include F (7.5 >= 7)
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('should apply cost 1.0 for incoming edges (parents)', () => {
      // E -> D -> C -> B -> A (start from A, traverse parents with cost 1.0)
      const graph: Graph = createGraph({
        'E': createTestNode('E', ['D']),
        'D': createTestNode('D', ['C']),
        'C': createTestNode('C', ['B']),
        'B': createTestNode('B', ['A']),
        'A': createTestNode('A', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 5)

      // Should include A, B (1.0), C (2.0), D (3.0), E (4.0) - all under 5
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    })

    it('should exclude parent nodes beyond distance threshold', () => {
      // Many parents -> ... -> A
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

      // Should include A, P1 (1.0), P2 (2.0), P3 (3.0), P4 (4.0)
      // Should NOT include P5 (5.0 >= 5), P6 (6.0 >= 5)
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'P1', 'P2', 'P3', 'P4'])
    })

    it('should respect different costs for parents vs children', () => {
      // Parent -> A -> Child
      // From A: Parent costs 1.0, Child costs 1.5
      const graph: Graph = createGraph({
        'Parent': createTestNode('Parent', ['A']),
        'A': createTestNode('A', ['Child']),
        'Child': createTestNode('Child', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 2)

      // Should include A (0), Parent (1.0), Child (1.5)
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'Child', 'Parent'])
    })
  })

  describe('complex graph topologies', () => {
    it('should handle star topology with mixed edge types', () => {
      // Central node with multiple children and parents
      const graph: Graph = createGraph({
        'P1': createTestNode('P1', ['Center']),
        'P2': createTestNode('P2', ['Center']),
        'Center': createTestNode('Center', ['C1', 'C2']),
        'C1': createTestNode('C1', []),
        'C2': createTestNode('C2', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'Center', 7)

      // Should include all nodes: Center, parents (1.0 each), children (1.5 each)
      expect(Object.keys(result.nodes).sort()).toEqual(['C1', 'C2', 'Center', 'P1', 'P2'])
    })

    it('should handle diamond topology', () => {
      // A -> B -> D
      // A -> C -> D
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', ['D']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // All nodes should be included
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
      // D should have edges from both B and C
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['D']))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['D']))
    })

    it('should handle bidirectional graph', () => {
      // A <-> B (mutual edges)
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
      // A -> B -> C -> A (cycle)
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', ['A'])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // Should visit all nodes in cycle exactly once
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
    })
  })

  describe('edge filtering', () => {
    it('should filter out edges where target is not in visited set', () => {
      // A -> B -> C
      // Start from A with maxDistance = 2 (only includes A and B)
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 2)

      // Only A and B should be included (C at distance 3.0 >= 2)
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      // B's edge to C should be filtered out since C is not in result
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should preserve edges when both endpoints are in visited set', () => {
      // A -> B -> C
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // All nodes included, all edges preserved
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['C']))
    })
  })

  describe('context node filtering', () => {
    const createContextNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
      relativeFilePathIsID: id,
      outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
      contentWithoutYamlOrLinks: `content of ${id}`,
      nodeUIMetadata: {
        color: O.none,
        position: O.none,
        additionalYAMLProps: new Map(),
        isContextNode: true
      }
    })

    it('should traverse through context nodes without including them', () => {
      // A -> ContextNode -> B
      // Start from A, should include A and B but NOT ContextNode (traverses through it)
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
    })

    it('should reconnect edges when traversing through context nodes', () => {
      // A -> ContextNode -> B
      // When ContextNode is excluded, A should have a direct edge to B
      // to preserve the tree structure in graphToAscii
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      // A should have edge to B (bridged through context node)
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should reconnect edges through multiple chained context nodes', () => {
      // A -> Ctx1 -> Ctx2 -> B
      // A should have direct edge to B even through 2 context nodes
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['Ctx1']),
        'Ctx1': createContextNode('Ctx1', ['Ctx2']),
        'Ctx2': createContextNode('Ctx2', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should reconnect edges to multiple children through context node', () => {
      // A -> ContextNode -> B, C, D
      // A should have edges to B, C, D
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B', 'C', 'D']),
        'B': createTestNode('B', []),
        'C': createTestNode('C', []),
        'D': createTestNode('D', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
      expect(result.nodes['A'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['B', 'C', 'D'])
    })

    it('should skip context nodes as parents during DFS traversal', () => {
      // ContextNode -> A -> B
      // Start from A, should include A and B, but NOT ContextNode parent
      const graph: Graph = createGraph({
        'ContextNode': createContextNode('ContextNode', ['A']),
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
    })

    it('should traverse around context nodes to reach regular nodes', () => {
      // A -> ContextNode -> C
      // A -> B -> C
      // Start from A, should reach C through B, but not through ContextNode
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode', 'B']),
        'ContextNode': createContextNode('ContextNode', ['C']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
    })

    it('should not include context nodes even if they are within distance threshold', () => {
      // A -> B (regular), A -> C (context node)
      // Both should be at the same distance, but C should be excluded
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', []),
        'C': createContextNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
    })

    it('should filter edges pointing to context nodes', () => {
      // A -> B (regular), A -> C (context node)
      // Edge A->C should be filtered out since C is not in result
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', []),
        'C': createContextNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should not add distance when traversing through context nodes', () => {
      // A -> ContextNode -> B -> C -> D -> E
      // Without context node distance: A(0) -> B(1.5) -> C(3.0) -> D(4.5) -> E(6.0)
      // With maxDistance=5, should include A, B, C, D (E at 6.0 >= 5 excluded)
      // Context node should NOT add to distance
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', ['E']),
        'E': createTestNode('E', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 5)

      // A(0), B(1.5), C(3.0), D(4.5) should be included
      // E(6.0) should be excluded (distance >= 5)
      // ContextNode should NOT be included
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
    })

    it('should not add distance for context node parents', () => {
      // D -> C -> B -> ContextNode -> A (start from A)
      // Parent costs: ContextNode(0, skipped), B(1.0), C(2.0), D(3.0)
      const graph: Graph = createGraph({
        'D': createTestNode('D', ['C']),
        'C': createTestNode('C', ['B']),
        'B': createTestNode('B', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['A']),
        'A': createTestNode('A', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 4)

      // A(0), B(1.0), C(2.0), D(3.0) should be included
      // ContextNode should NOT be included
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
    })

    // REGRESSION: Previously, the traversal would stop entirely at context nodes,
    // causing all descendants behind a context node to be lost. This test ensures
    // that deep subtrees behind context nodes are still reachable.
    it('regression: should find entire subtree behind a context node', () => {
      // A -> ContextNode -> B -> C -> D
      //                         |
      //                         v
      //                         E -> F
      // All of B, C, D, E, F are ONLY reachable through ContextNode
      // The bug would return only [A], losing the entire subtree
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', ['D', 'E']),
        'D': createTestNode('D', []),
        'E': createTestNode('E', ['F']),
        'F': createTestNode('F', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 10)

      // Should find ALL nodes except ContextNode
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
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

      // Only start node at distance 0
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

      expect(result.nodes['A'].relativeFilePathIsID).toBe('A')
      expect(result.nodes['A'].contentWithoutYamlOrLinks).toBe('content of A')
      expect(result.nodes['A'].nodeUIMetadata).toEqual(graph.nodes['A'].nodeUIMetadata)
    })
  })

  describe('bridging edge edge cases', () => {
    const createContextNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
      relativeFilePathIsID: id,
      outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
      contentWithoutYamlOrLinks: `content of ${id}`,
      nodeUIMetadata: {
        color: O.none,
        position: O.none,
        additionalYAMLProps: new Map(),
        isContextNode: true
      }
    })

    const toEdges: (ids: readonly string[]) => readonly { readonly targetId: string; readonly label: string; }[] = (ids: readonly string[]) => ids.map(targetId => ({ targetId, label: '' }))

    it('should handle starting from a context node (no bridges created)', () => {
      // ContextNode -> A -> B
      // Starting from ContextNode, there's no lastNonContextAncestor to bridge from
      // Should still include A and B, just no bridging
      const graph: Graph = createGraph({
        'ContextNode': createContextNode('ContextNode', ['A']),
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'ContextNode', 7)

      // Context node is excluded, but A and B should be reachable
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should handle multiple parents through the same context node', () => {
      // P1 -> ContextNode -> C
      // P2 -> ContextNode
      // Start from P1: P1 should have bridge to C, AND connect to P2 (bidirectional reachability)
      // In bidirectional traversal, P1 and P2 can reach each other via ContextNode's incoming edges
      const graph: Graph = createGraph({
        'P1': createTestNode('P1', ['ContextNode']),
        'P2': createTestNode('P2', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'P1', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['C', 'P1', 'P2'])
      // P1 should have bridged edge to C AND edge to P2 (fellow incomer)
      expect(result.nodes['P1'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['C', 'P2'])
    })

    it('should handle diamond topology with context node in one path', () => {
      // A -> ContextNode -> C
      // A -> B -> C
      // A should have edges to both B (direct) and C (bridged through ContextNode)
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode', 'B']),
        'ContextNode': createContextNode('ContextNode', ['C']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
      // A should have edges to both B and C
      expect(result.nodes['A'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['B', 'C'])
      // B should still have edge to C
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['C']))
    })

    it('should handle orphan context subtree (only context nodes as ancestors)', () => {
      // Ctx1 -> Ctx2 -> A -> B
      // Start from A: context node ancestors are removed, no bridges needed
      const graph: Graph = createGraph({
        'Ctx1': createContextNode('Ctx1', ['Ctx2']),
        'Ctx2': createContextNode('Ctx2', ['A']),
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      // A should only have edge to B (no self-referential edge)
      expect(result.nodes['A'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['B'])
    })

    it('should handle context node with both context and non-context children', () => {
      // A -> ContextNode -> B (regular)
      //                  -> Ctx2 (context) -> C
      // A should have bridged edges to both B and C
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B', 'Ctx2']),
        'B': createTestNode('B', []),
        'Ctx2': createContextNode('Ctx2', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
      expect(result.nodes['A'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['B', 'C'])
    })

    it('should not duplicate edges when bridged target already has direct edge', () => {
      // A -> ContextNode -> B
      // A -> B (direct edge)
      // A should have only one edge to B, not two
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode', 'B']),
        'ContextNode': createContextNode('ContextNode', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      // Should have exactly one edge to B, not duplicated
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should handle long chain with alternating context and regular nodes', () => {
      // A -> Ctx1 -> B -> Ctx2 -> C -> Ctx3 -> D
      // A should have edge to B
      // B should have edge to C
      // C should have edge to D
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['Ctx1']),
        'Ctx1': createContextNode('Ctx1', ['B']),
        'B': createTestNode('B', ['Ctx2']),
        'Ctx2': createContextNode('Ctx2', ['C']),
        'C': createTestNode('C', ['Ctx3']),
        'Ctx3': createContextNode('Ctx3', ['D']),
        'D': createTestNode('D', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 15)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['C']))
      expect(result.nodes['C'].outgoingEdges).toEqual(toEdges(['D']))
    })

    it('should handle context node with no children (leaf context node)', () => {
      // A -> ContextNode (leaf)
      // No bridging needed, A should have no outgoing edges in result
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should handle graph with only context nodes (empty result)', () => {
      // Ctx1 -> Ctx2 -> Ctx3
      const graph: Graph = createGraph({
        'Ctx1': createContextNode('Ctx1', ['Ctx2']),
        'Ctx2': createContextNode('Ctx2', ['Ctx3']),
        'Ctx3': createContextNode('Ctx3', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'Ctx1', 7)

      expect(Object.keys(result.nodes)).toEqual([])
    })
  })
})

describe('getUnionSubgraphByDistance', () => {
  const createTestNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    relativeFilePathIsID: id,
    outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  const createContextNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    relativeFilePathIsID: id,
    outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: true
    }
  })

  const toEdges: (ids: readonly string[]) => readonly { readonly targetId: string; readonly label: string; }[] = (ids: readonly string[]) => ids.map(targetId => ({ targetId, label: '' }))

  it('should merge subgraphs from multiple starting nodes', () => {
    // A -> B, C -> D (disconnected)
    const graph: Graph = createGraph({
      'A': createTestNode('A', ['B']),
      'B': createTestNode('B', []),
      'C': createTestNode('C', ['D']),
      'D': createTestNode('D', [])
    })

    const result: Graph = getUnionSubgraphByDistance(graph, ['A', 'C'], 7)

    expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('should preserve bridging edges when merging subgraphs', () => {
    // A -> ContextNode -> B
    // Start from A, should have bridged edge A -> B in the union result
    const graph: Graph = createGraph({
      'A': createTestNode('A', ['ContextNode']),
      'ContextNode': createContextNode('ContextNode', ['B']),
      'B': createTestNode('B', [])
    })

    const result: Graph = getUnionSubgraphByDistance(graph, ['A'], 7)

    expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
    // With pre-transformation approach, bridging edges are correctly preserved
    expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
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
