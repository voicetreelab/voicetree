import { describe, it, expect } from 'vitest'
import { graphToSpanningTree } from './graphToSpanningTree'
import type { Graph, GraphNode, Edge } from '@/pure/graph'
import { createGraph as createGraphWithIndex, createEmptyGraph } from '@/pure/graph/createGraph'
import * as O from 'fp-ts/lib/Option.js'

describe('graphToSpanningTree', () => {
  const createTestNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    relativeFilePathIsID: id,
    outgoingEdges: edges.map((targetId: string): Edge => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  const createGraph: (nodeDefinitions: Record<string, readonly string[]>) => Graph = (nodeDefinitions: Record<string, readonly string[]>): Graph =>
    createGraphWithIndex(Object.fromEntries(
      Object.entries(nodeDefinitions).map(([id, edges]: readonly [string, readonly string[]]): readonly [string, GraphNode] =>
        [id, createTestNode(id, edges)]
      )
    ))

  const getEdgeSet: (graph: Graph) => ReadonlySet<string> = (graph: Graph): ReadonlySet<string> =>
    new Set(
      Object.entries(graph.nodes).flatMap(([nodeId, node]: readonly [string, GraphNode]): readonly string[] =>
        node.outgoingEdges.map((edge: Edge): string => `${nodeId}->${edge.targetId}`)
      )
    )

  const countEdges: (graph: Graph) => number = (graph: Graph): number =>
    Object.values(graph.nodes).reduce(
      (sum: number, node: GraphNode): number => sum + node.outgoingEdges.length,
      0
    )

  // ==========================================================================
  // BASIC CASES - Should return same graph (no cycles to remove)
  // ==========================================================================

  describe('basic cases (no cycles)', () => {
    it('should return same graph for single node', () => {
      const graph: Graph = createGraph({ 'A': [] })

      const result: Graph = graphToSpanningTree(graph, 'A')

      expect(Object.keys(result.nodes)).toEqual(['A'])
      expect(result.nodes['A'].outgoingEdges).toEqual([])
    })

    it('should return same graph for linear chain (A→B→C)', () => {
      const graph: Graph = createGraph({
        'A': ['B'],
        'B': ['C'],
        'C': []
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
      expect(getEdgeSet(result)).toEqual(new Set(['A->B', 'B->C']))
    })

    it('should return same graph for tree structure', () => {
      const graph: Graph = createGraph({
        'Root': ['Child1', 'Child2'],
        'Child1': ['Grandchild1', 'Grandchild2'],
        'Child2': [],
        'Grandchild1': [],
        'Grandchild2': []
      })

      const result: Graph = graphToSpanningTree(graph, 'Root')

      expect(Object.keys(result.nodes).sort()).toEqual([
        'Child1', 'Child2', 'Grandchild1', 'Grandchild2', 'Root'
      ])
      expect(getEdgeSet(result)).toEqual(new Set([
        'Root->Child1', 'Root->Child2',
        'Child1->Grandchild1', 'Child1->Grandchild2'
      ]))
    })
  })

  // ==========================================================================
  // CYCLE CASES - Should remove edges to break cycles
  // ==========================================================================

  describe('cycle cases', () => {
    it('should break simple cycle (A→B→C→A) by removing one edge', () => {
      const graph: Graph = createGraph({
        'A': ['B'],
        'B': ['C'],
        'C': ['A']  // Creates cycle back to A
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      // All nodes should be present
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])

      // Should have exactly 2 edges (tree with 3 nodes has n-1 = 2 edges)
      expect(countEdges(result)).toBe(2)

      // The back-edge C→A should be removed (creates cycle)
      expect(getEdgeSet(result)).not.toContain('C->A')

      // Forward edges should be preserved
      expect(getEdgeSet(result)).toContain('A->B')
      expect(getEdgeSet(result)).toContain('B->C')
    })

    it('should remove self-loop (A→A)', () => {
      const graph: Graph = createGraph({
        'A': ['A', 'B'],  // Self-loop plus normal edge
        'B': []
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      // All nodes should be present
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])

      // Self-loop should be removed
      expect(getEdgeSet(result)).not.toContain('A->A')

      // Normal edge should be preserved
      expect(getEdgeSet(result)).toContain('A->B')
    })

    it('should handle diamond with cycle (A→B→D, A→C→D, D→A)', () => {
      const graph: Graph = createGraph({
        'A': ['B', 'C'],
        'B': ['D'],
        'C': ['D'],
        'D': ['A']  // Creates cycle back to A
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      // All nodes should be present
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])

      // D→A should be removed (creates cycle)
      expect(getEdgeSet(result)).not.toContain('D->A')

      // Also one of the diamond edges should be removed (D reached twice)
      // Tree with 4 nodes should have 3 edges
      expect(countEdges(result)).toBe(3)
    })

    it('should handle multiple disconnected cycles', () => {
      // Two separate cycles: A→B→A and C→D→C
      // When starting from A, the C→D→C cycle needs to be handled via incoming edges
      const graph: Graph = createGraph({
        'A': ['B'],
        'B': ['A'],
        'C': ['D'],
        'D': ['C']
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      // All nodes reachable via bidirectional traversal should be present
      // Note: C and D may not be reachable if there's no connection from A
      // This test verifies cycle breaking within the reachable subgraph
      expect(Object.keys(result.nodes)).toContain('A')
      expect(Object.keys(result.nodes)).toContain('B')

      // Within the reachable portion, no cycles should exist
      // If A and B are the only reachable nodes, should have 1 edge
      const reachableEdges: number = countEdges(result)
      const reachableNodes: number = Object.keys(result.nodes).length

      // Tree property: edges = nodes - 1 (for connected tree)
      // But may have disconnected components in spanning forest
      expect(reachableEdges).toBeLessThan(reachableNodes)
    })
  })

  // ==========================================================================
  // BIDIRECTIONAL CASES - Should follow both outgoing and incoming edges
  // ==========================================================================

  describe('bidirectional traversal', () => {
    it('should include external branch from cycle (A→B→C→A, A→D→E)', () => {
      const graph: Graph = createGraph({
        'A': ['B', 'D'],
        'B': ['C'],
        'C': ['A'],  // Cycle back to A
        'D': ['E'],
        'E': []
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      // All nodes should be present
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])

      // Tree with 5 nodes should have 4 edges
      expect(countEdges(result)).toBe(4)

      // Cycle back-edge should be removed
      expect(getEdgeSet(result)).not.toContain('C->A')
    })

    it('should include node reachable only via incoming edge', () => {
      // B→A, A→C: Starting from A, B is only reachable via incoming edge
      const graph: Graph = createGraph({
        'A': ['C'],
        'B': ['A'],
        'C': []
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      // All nodes should be present (B reachable via incoming edge)
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])

      // Tree with 3 nodes should have 2 edges
      expect(countEdges(result)).toBe(2)
    })

    it('should handle mixed incoming/outgoing paths to same node', () => {
      // A→B→D, C→A, C→D: Starting from A
      // D reachable via A→B→D (outgoing path)
      // C reachable via C→A (incoming from A)
      // D also reachable via C→D but should not create duplicate
      const graph: Graph = createGraph({
        'A': ['B'],
        'B': ['D'],
        'C': ['A', 'D'],
        'D': []
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      // All nodes should be present
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D'])

      // Tree with 4 nodes should have 3 edges
      expect(countEdges(result)).toBe(3)

      // D should appear exactly once
      expect(Object.keys(result.nodes).filter((id: string): boolean => id === 'D').length).toBe(1)
    })
  })

  // ==========================================================================
  // ROOT SELECTION - Starting from different nodes in same graph
  // ==========================================================================

  describe('root selection', () => {
    it('should produce different trees when starting from different nodes in cycle', () => {
      const graph: Graph = createGraph({
        'A': ['B'],
        'B': ['C'],
        'C': ['A']
      })

      const resultFromA: Graph = graphToSpanningTree(graph, 'A')
      const resultFromB: Graph = graphToSpanningTree(graph, 'B')
      const resultFromC: Graph = graphToSpanningTree(graph, 'C')

      // All results should have all 3 nodes
      expect(Object.keys(resultFromA.nodes).sort()).toEqual(['A', 'B', 'C'])
      expect(Object.keys(resultFromB.nodes).sort()).toEqual(['A', 'B', 'C'])
      expect(Object.keys(resultFromC.nodes).sort()).toEqual(['A', 'B', 'C'])

      // All results should have 2 edges (tree property)
      expect(countEdges(resultFromA)).toBe(2)
      expect(countEdges(resultFromB)).toBe(2)
      expect(countEdges(resultFromC)).toBe(2)

      // Different edges should be removed based on root
      // From A: C→A removed
      expect(getEdgeSet(resultFromA)).not.toContain('C->A')

      // From B: A→B removed (would create back-edge to already visited B)
      expect(getEdgeSet(resultFromB)).not.toContain('A->B')

      // From C: B→C removed
      expect(getEdgeSet(resultFromC)).not.toContain('B->C')
    })

    it('should have root as first traversable node', () => {
      const graph: Graph = createGraph({
        'Root': ['A', 'B'],
        'A': ['C'],
        'B': [],
        'C': []
      })

      const result: Graph = graphToSpanningTree(graph, 'Root')

      // Root should be in the result
      expect(result.nodes['Root']).toBeDefined()

      // Root should have its outgoing edges preserved (leading to tree)
      expect(result.nodes['Root'].outgoingEdges.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty graph', () => {
      const graph: Graph = createEmptyGraph()

      const result: Graph = graphToSpanningTree(graph, 'nonexistent')

      expect(Object.keys(result.nodes)).toEqual([])
    })

    it('should handle root not in graph', () => {
      const graph: Graph = createGraph({
        'A': ['B'],
        'B': []
      })

      const result: Graph = graphToSpanningTree(graph, 'nonexistent')

      // When root doesn't exist, result should be empty or contain no nodes
      expect(Object.keys(result.nodes).length).toBe(0)
    })

    it('should preserve node content and metadata', () => {
      const graph: Graph = createGraph({
        'A': ['B'],
        'B': ['A']  // Cycle
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      // Node content should be preserved
      expect(result.nodes['A'].contentWithoutYamlOrLinks).toBe('content of A')
      expect(result.nodes['B'].contentWithoutYamlOrLinks).toBe('content of B')

      // Node metadata should be preserved
      expect(result.nodes['A'].nodeUIMetadata.isContextNode).toBe(false)
    })

    it('should handle deeply nested cycle', () => {
      // A→B→C→D→E→A (5-node cycle)
      const graph: Graph = createGraph({
        'A': ['B'],
        'B': ['C'],
        'C': ['D'],
        'D': ['E'],
        'E': ['A']  // Back to start
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      // All nodes present
      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])

      // Tree with 5 nodes has 4 edges
      expect(countEdges(result)).toBe(4)

      // Back-edge removed
      expect(getEdgeSet(result)).not.toContain('E->A')
    })

    it('should handle node with multiple self-loops', () => {
      // Node A has edges to itself multiple times
      const node: GraphNode = {
        relativeFilePathIsID: 'A',
        outgoingEdges: [
          { targetId: 'A', label: '' },
          { targetId: 'A', label: 'second' },
          { targetId: 'B', label: '' }
        ],
        contentWithoutYamlOrLinks: 'content of A',
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          additionalYAMLProps: new Map(),
          isContextNode: false
        }
      }

      const graph: Graph = createGraphWithIndex({
        'A': node,
        'B': createTestNode('B', [])
      })

      const result: Graph = graphToSpanningTree(graph, 'A')

      // All self-loops should be removed
      const aEdges: readonly Edge[] = result.nodes['A'].outgoingEdges.filter(
        (e: Edge): boolean => e.targetId === 'A'
      )
      expect(aEdges.length).toBe(0)

      // Edge to B should be preserved
      expect(result.nodes['A'].outgoingEdges.some((e: Edge): boolean => e.targetId === 'B')).toBe(true)
    })
  })
})
