import { describe, it, expect } from 'vitest'
import { getNodeIdsInTraversalOrder } from './getNodeIdsInTraversalOrder'
import type { Graph, GraphNode } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

describe('getNodeIdsInTraversalOrder', () => {
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

  it('should return single node for single node graph', () => {
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', [])
      }
    }

    const result: string[] = getNodeIdsInTraversalOrder(graph)

    expect(result).toEqual(['A'])
  })

  it('should return nodes in depth-first order (tests nesting and branching)', () => {
    const graph: Graph = {
      nodes: {
        'Root': createTestNode('Root', ['Child1', 'Child2']),
        'Child1': createTestNode('Child1', ['Grandchild1', 'Grandchild2']),
        'Child2': createTestNode('Child2', []),
        'Grandchild1': createTestNode('Grandchild1', []),
        'Grandchild2': createTestNode('Grandchild2', [])
      }
    }

    const result: string[] = getNodeIdsInTraversalOrder(graph)

    // Depth-first: Root -> Child1 -> Grandchild1 -> Grandchild2 -> Child2
    expect(result).toEqual(['Root', 'Child1', 'Grandchild1', 'Grandchild2', 'Child2'])
  })

  it('should handle empty graph', () => {
    const graph: Graph = {
      nodes: {}
    }

    const result: string[] = getNodeIdsInTraversalOrder(graph)

    expect(result).toEqual([])
  })

  it('should handle DAG with shared descendants (visited set prevents duplicates)', () => {
    // Diamond shape: A -> B -> D, A -> C -> D
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B', 'C']),
        'B': createTestNode('B', ['D']),
        'C': createTestNode('C', ['D']),
        'D': createTestNode('D', [])
      }
    }

    const result: string[] = getNodeIdsInTraversalOrder(graph)

    // D should only appear once (first time visited via B)
    expect(result).toEqual(['A', 'B', 'D', 'C'])
  })

  it('should handle multiple root nodes', () => {
    const graph: Graph = {
      nodes: {
        'Root1': createTestNode('Root1', ['Child1']),
        'Root2': createTestNode('Root2', ['Child2']),
        'Child1': createTestNode('Child1', []),
        'Child2': createTestNode('Child2', [])
      }
    }

    const result: string[] = getNodeIdsInTraversalOrder(graph)

    // Should include all nodes, roots processed in object key order
    expect(result.length).toBe(4)
    expect(result).toContain('Root1')
    expect(result).toContain('Root2')
    expect(result).toContain('Child1')
    expect(result).toContain('Child2')

    // Root1 should come before Child1
    expect(result.indexOf('Root1')).toBeLessThan(result.indexOf('Child1'))
    // Root2 should come before Child2
    expect(result.indexOf('Root2')).toBeLessThan(result.indexOf('Child2'))
  })

  it('should handle graph with cycle gracefully (visited set prevents infinite loop)', () => {
    const graph: Graph = {
      nodes: {
        'A': createTestNode('A', ['B']),
        'B': createTestNode('B', ['A'])
      }
    }

    const result: string[] = getNodeIdsInTraversalOrder(graph)

    // In a pure cycle, neither node is a root, so result is empty
    expect(result).toEqual([])
  })

  it('should match the example from graphToAscii spec', () => {
    const graph: Graph = {
      nodes: {
        'Root Node': createTestNode('Root Node', ['Child 1', 'Child 2', 'Child 3']),
        'Child 1': createTestNode('Child 1', ['Grandchild 1', 'Grandchild 2']),
        'Child 2': createTestNode('Child 2', []),
        'Child 3': createTestNode('Child 3', ['Grandchild 3']),
        'Grandchild 1': createTestNode('Grandchild 1', []),
        'Grandchild 2': createTestNode('Grandchild 2', []),
        'Grandchild 3': createTestNode('Grandchild 3', [])
      }
    }

    const result: string[] = getNodeIdsInTraversalOrder(graph)

    // Depth-first traversal order
    expect(result).toEqual([
      'Root Node',
      'Child 1',
      'Grandchild 1',
      'Grandchild 2',
      'Child 2',
      'Child 3',
      'Grandchild 3'
    ])
  })
})
