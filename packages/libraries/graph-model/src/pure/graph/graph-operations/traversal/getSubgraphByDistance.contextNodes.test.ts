/**
 * Context node filtering tests for getSubgraphByDistance.
 *
 * Context nodes are removed from the graph before traversal via removeContextNodes.
 * Since deleteNodeSimple does not create transitive edges, nodes only reachable
 * through context nodes become disconnected and are not included in results.
 */
import { describe, it, expect } from 'vitest'
import { getSubgraphByDistance, getUnionSubgraphByDistance } from './getSubgraphByDistance'
import type { Graph, GraphNode } from '../..'
import { createGraph } from '../../construction/createGraph'
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

const createContextNode: (id: string, edges?: readonly string[]) => GraphNode = (id: string, edges: readonly string[] = []): GraphNode => ({
    kind: 'leaf',
    absoluteFilePathIsID: id,
    outgoingEdges: edges.map(targetId => ({ targetId, label: '' })),
    contentWithoutYamlOrLinks: `content of ${id}`,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
      isContextNode: true
    }
})

const toEdges: (ids: readonly string[]) => readonly { readonly targetId: string; readonly label: string; }[] = (ids: readonly string[]) => ids.map(targetId => ({ targetId, label: '' }))

describe('getSubgraphByDistance — context node filtering', () => {
    it('should exclude context nodes and nodes only reachable through them', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
    })

    it('should not create bridged edges when context node is removed', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should not traverse through chained context nodes', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['Ctx1']),
        'Ctx1': createContextNode('Ctx1', ['Ctx2']),
        'Ctx2': createContextNode('Ctx2', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should not reconnect edges to context node children', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B', 'C', 'D']),
        'B': createTestNode('B', []),
        'C': createTestNode('C', []),
        'D': createTestNode('D', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should skip context nodes as parents during DFS traversal', () => {
      const graph: Graph = createGraph({
        'ContextNode': createContextNode('ContextNode', ['A']),
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
    })

    it('should traverse around context nodes to reach regular nodes', () => {
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
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', []),
        'C': createContextNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
    })

    it('should filter edges pointing to context nodes', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', []),
        'C': createContextNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should not reach nodes behind context nodes (no bridging)', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', ['E']),
        'E': createTestNode('E', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 5)

      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
    })

    it('should not reach nodes behind context node parents (no bridging)', () => {
      const graph: Graph = createGraph({
        'D': createTestNode('D', ['C']),
        'C': createTestNode('C', ['B']),
        'B': createTestNode('B', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['A']),
        'A': createTestNode('A', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 4)

      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
    })

    it('nodes behind context node are unreachable when only path goes through it', () => {
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

      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
    })
})

describe('getSubgraphByDistance — context node edge cases', () => {
    it('should handle starting from a context node (no bridges created)', () => {
      const graph: Graph = createGraph({
        'ContextNode': createContextNode('ContextNode', ['A']),
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'ContextNode', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should not reach nodes through removed context node (multiple parents)', () => {
      // P1 -> ContextNode -> C, P2 -> ContextNode
      // ContextNode removed — C unreachable, P2 unreachable from P1
      const graph: Graph = createGraph({
        'P1': createTestNode('P1', ['ContextNode']),
        'P2': createTestNode('P2', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'P1', 7)

      // Only P1 — C and P2 are behind ContextNode
      expect(Object.keys(result.nodes).sort()).toEqual(['P1'])
    })

    it('should handle diamond topology with context node in one path', () => {
      // A -> ContextNode -> C, A -> B -> C
      // ContextNode removed, A keeps edge to B, reaches C through B
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode', 'B']),
        'ContextNode': createContextNode('ContextNode', ['C']),
        'B': createTestNode('B', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B', 'C'])
      // A only keeps edge to B (edge to ContextNode removed)
      expect(result.nodes['A'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['B'])
      expect(result.nodes['B'].outgoingEdges).toEqual(toEdges(['C']))
    })

    it('should handle orphan context subtree (only context nodes as ancestors)', () => {
      const graph: Graph = createGraph({
        'Ctx1': createContextNode('Ctx1', ['Ctx2']),
        'Ctx2': createContextNode('Ctx2', ['A']),
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      expect(result.nodes['A'].outgoingEdges.map(e => e.targetId).sort()).toEqual(['B'])
    })

    it('should not reach nodes behind context node with mixed children', () => {
      // A -> ContextNode -> B (regular), ContextNode -> Ctx2 -> C
      // ContextNode removed — B and C unreachable from A
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', ['B', 'Ctx2']),
        'B': createTestNode('B', []),
        'Ctx2': createContextNode('Ctx2', ['C']),
        'C': createTestNode('C', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
    })

    it('should not duplicate edges when direct edge exists alongside context node edge', () => {
      // A -> ContextNode -> B, A -> B (direct)
      // ContextNode removed, A keeps direct edge to B
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode', 'B']),
        'ContextNode': createContextNode('ContextNode', ['B']),
        'B': createTestNode('B', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A', 'B'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges(['B']))
    })

    it('should not traverse alternating context/regular chains', () => {
      // A -> Ctx1 -> B -> Ctx2 -> C -> Ctx3 -> D
      // Context nodes removed — B unreachable from A (only path is through Ctx1)
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

      // A is isolated after context node removal (only path is through Ctx1)
      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
    })

    it('should handle context node with no children (leaf context node)', () => {
      const graph: Graph = createGraph({
        'A': createTestNode('A', ['ContextNode']),
        'ContextNode': createContextNode('ContextNode', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'A', 7)

      expect(Object.keys(result.nodes).sort()).toEqual(['A'])
      expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
    })

    it('should handle graph with only context nodes (empty result)', () => {
      const graph: Graph = createGraph({
        'Ctx1': createContextNode('Ctx1', ['Ctx2']),
        'Ctx2': createContextNode('Ctx2', ['Ctx3']),
        'Ctx3': createContextNode('Ctx3', [])
      })

      const result: Graph = getSubgraphByDistance(graph, 'Ctx1', 7)

      expect(Object.keys(result.nodes)).toEqual([])
    })
})

describe('getUnionSubgraphByDistance — context nodes', () => {
  it('should not create bridged edges through context nodes', () => {
    // A -> ContextNode -> B — no bridging after context node removal
    const graph: Graph = createGraph({
      'A': createTestNode('A', ['ContextNode']),
      'ContextNode': createContextNode('ContextNode', ['B']),
      'B': createTestNode('B', [])
    })

    const result: Graph = getUnionSubgraphByDistance(graph, ['A'], 7)

    // Only A — B unreachable through removed ContextNode
    expect(Object.keys(result.nodes).sort()).toEqual(['A'])
    expect(result.nodes['A'].outgoingEdges).toEqual(toEdges([]))
  })
})
