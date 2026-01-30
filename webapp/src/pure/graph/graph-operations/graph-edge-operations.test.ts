import { describe, it, expect } from 'vitest'
import {
  addOutgoingEdge,
  removeOutgoingEdge,
  removeOutgoingEdges,
  setOutgoingEdges
} from '@/pure/graph/graph-operations/graph-edge-operations'
import type { GraphNode, Edge } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

describe('graph-edge-operations', () => {
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

  describe('addOutgoingEdge', () => {
    it('should add an edge to a node with existing edges', () => {
      const node: GraphNode = createTestNode('node1', [{ targetId: 'node2', label: '' }])
      const result: GraphNode = addOutgoingEdge(node, 'node3')

      expect(result.outgoingEdges).toEqual([{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
    })

    it('should not add duplicate edges', () => {
      const node: GraphNode = createTestNode('node1', [{ targetId: 'node2', label: '' }])
      const result: GraphNode = addOutgoingEdge(node, 'node2')

      expect(result.outgoingEdges).toEqual([{ targetId: 'node2', label: '' }])
    })
  })

  describe('removeOutgoingEdge', () => {
    it('should remove an edge from a node', () => {
      const node: GraphNode = createTestNode('node1', [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
      const result: GraphNode = removeOutgoingEdge(node, 'node2')

      expect(result.outgoingEdges).toEqual([{ targetId: 'node3', label: '' }])
    })
  })

  describe('removeOutgoingEdges', () => {
    it('should remove multiple edges from a node', () => {
      const node: GraphNode = createTestNode('node1', [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }, { targetId: 'node4', label: '' }])
      const result: GraphNode = removeOutgoingEdges(node, ['node2', 'node4'])

      expect(result.outgoingEdges).toEqual([{ targetId: 'node3', label: '' }])
    })
  })

  describe('setOutgoingEdges', () => {
    it('should replace all edges with new set', () => {
      const node: GraphNode = createTestNode('node1', [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
      const result: GraphNode = setOutgoingEdges(node, [{ targetId: 'node4', label: '' }, { targetId: 'node5', label: '' }])

      expect(result.outgoingEdges).toEqual([{ targetId: 'node4', label: '' }, { targetId: 'node5', label: '' }])
    })

    it('should preserve other node properties', () => {
      const node: GraphNode = createTestNode('node1', [{ targetId: 'node2', label: '' }])
      const result: GraphNode = setOutgoingEdges(node, [{ targetId: 'node3', label: '' }])

      expect(result.absoluteFilePathIsID).toBe('node1')
      expect(result.contentWithoutYamlOrLinks).toBe('test content')
      expect(result.nodeUIMetadata).toEqual(node.nodeUIMetadata)
    })
  })
})
