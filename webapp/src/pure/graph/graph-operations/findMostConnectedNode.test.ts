import { describe, it, expect } from 'vitest'
import { findMostConnectedNode } from '@/pure/graph/graph-operations/findMostConnectedNode'
import type { Graph, GraphNode, Edge, NodeIdAndFilePath } from '@/pure/graph'
import { buildIncomingEdgesIndex } from '@/pure/graph/graph-operations/incomingEdgesIndex'
import * as O from 'fp-ts/lib/Option.js'

const createTestNode: (id: string, edges?: readonly Edge[]) => GraphNode = (id: string, edges: readonly Edge[] = []): GraphNode => ({
  absoluteFilePathIsID: id,
  outgoingEdges: edges,
  contentWithoutYamlOrLinks: 'test content',
  nodeUIMetadata: {
    color: O.none,
    position: O.none,
    additionalYAMLProps: new Map(),
    isContextNode: false
  }
})

const createGraphFromNodes: (nodes: Record<NodeIdAndFilePath, GraphNode>) => Graph = (nodes: Record<NodeIdAndFilePath, GraphNode>): Graph => ({
  nodes,
  incomingEdgesIndex: buildIncomingEdgesIndex(nodes)
})

describe('findMostConnectedNode', () => {
  describe('most-connected node selection (highest edge count wins)', () => {
    it('should return the node with highest total edge count', () => {
      // Graph: a -> b -> c, d -> b
      // Edge counts: a=1(out), b=3(1out+2in), c=1(in), d=1(out)
      // b has the most connections
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'a': createTestNode('a', [{ targetId: 'b', label: '' }]),
        'b': createTestNode('b', [{ targetId: 'c', label: '' }]),
        'c': createTestNode('c', []),
        'd': createTestNode('d', [{ targetId: 'b', label: '' }])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const result: NodeIdAndFilePath = findMostConnectedNode(['a', 'b', 'c', 'd'], graph)

      expect(result).toBe('b')
    })

    it('should count both incoming and outgoing edges', () => {
      // Graph: a -> b -> c
      // a has 1 outgoing
      // b has 1 outgoing + 1 incoming = 2
      // c has 1 incoming
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'a': createTestNode('a', [{ targetId: 'b', label: '' }]),
        'b': createTestNode('b', [{ targetId: 'c', label: '' }]),
        'c': createTestNode('c', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const result: NodeIdAndFilePath = findMostConnectedNode(['a', 'b', 'c'], graph)

      expect(result).toBe('b')
    })

    it('should handle nodes with multiple outgoing edges', () => {
      // Graph: a -> b, a -> c, a -> d
      // a has 3 outgoing edges, b,c,d each have 1 incoming
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'a': createTestNode('a', [
          { targetId: 'b', label: '' },
          { targetId: 'c', label: '' },
          { targetId: 'd', label: '' }
        ]),
        'b': createTestNode('b', []),
        'c': createTestNode('c', []),
        'd': createTestNode('d', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const result: NodeIdAndFilePath = findMostConnectedNode(['a', 'b', 'c', 'd'], graph)

      expect(result).toBe('a')
    })
  })

  describe('tie-breaking by selection order (first selected wins)', () => {
    it('should return first node in selection when edge counts are equal', () => {
      // Graph: a -> c, b -> c
      // Both a and b have 1 edge each
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'a': createTestNode('a', [{ targetId: 'c', label: '' }]),
        'b': createTestNode('b', [{ targetId: 'c', label: '' }]),
        'c': createTestNode('c', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      // When a is first in selection, a wins
      expect(findMostConnectedNode(['a', 'b'], graph)).toBe('a')
      // When b is first in selection, b wins
      expect(findMostConnectedNode(['b', 'a'], graph)).toBe('b')
    })

    it('should preserve selection order for tie-breaking among multiple tied nodes', () => {
      // Graph: isolated nodes with no edges
      // All have 0 edges, first in selection wins
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'a': createTestNode('a', []),
        'b': createTestNode('b', []),
        'c': createTestNode('c', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      expect(findMostConnectedNode(['c', 'b', 'a'], graph)).toBe('c')
      expect(findMostConnectedNode(['b', 'c', 'a'], graph)).toBe('b')
    })
  })

  describe('edge cases', () => {
    it('should return the only node when selection has one node', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'a': createTestNode('a', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const result: NodeIdAndFilePath = findMostConnectedNode(['a'], graph)

      expect(result).toBe('a')
    })

    it('should handle nodes not in selection (only consider selected nodes)', () => {
      // Graph: hub -> a, hub -> b, hub -> c
      // hub has 3 edges, but is NOT in selection
      // a, b, c each have 1 edge
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'hub': createTestNode('hub', [
          { targetId: 'a', label: '' },
          { targetId: 'b', label: '' },
          { targetId: 'c', label: '' }
        ]),
        'a': createTestNode('a', []),
        'b': createTestNode('b', []),
        'c': createTestNode('c', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      // hub is not in selection, so a (first selected) wins among equals
      const result: NodeIdAndFilePath = findMostConnectedNode(['a', 'b', 'c'], graph)

      expect(result).toBe('a')
    })

    it('should handle self-referential edges', () => {
      // Node a points to itself (1 outgoing + 1 incoming = 2 edges)
      // Node b has no edges
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'a': createTestNode('a', [{ targetId: 'a', label: '' }]),
        'b': createTestNode('b', [])
      }
      const graph: Graph = createGraphFromNodes(nodes)

      const result: NodeIdAndFilePath = findMostConnectedNode(['a', 'b'], graph)

      expect(result).toBe('a')
    })
  })
})
