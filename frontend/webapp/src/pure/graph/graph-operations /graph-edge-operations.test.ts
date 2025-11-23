import { describe, it, expect } from 'vitest'
import {
  addOutgoingEdge,
  removeOutgoingEdge,
  removeOutgoingEdges,
  setOutgoingEdges
} from '@/pure/graph/graph-operations /graph-edge-operations.ts'
import type { GraphNode, Edge } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

describe('graph-edge-operations', () => {
  const createTestNode = (id: string, edges: Edge[] = []): GraphNode => ({
    relativeFilePathIsID: id,
    outgoingEdges: edges,
    contentWithoutYamlOrLinks: 'test content',
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      title: id
    }
  })

  describe('addOutgoingEdge', () => {
    it('should add an edge to a node with no edges', () => {
      const node = createTestNode('node1', [])
      const result = addOutgoingEdge(node, 'node2')

      expect(result.outgoingEdges).toEqual([{ targetId: 'node2', label: '' }])
      expect(result.relativeFilePathIsID).toBe('node1')
    })

    it('should add an edge to a node with existing edges', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }])
      const result = addOutgoingEdge(node, 'node3')

      expect(result.outgoingEdges).toEqual([{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
    })

    it('should not add duplicate edges', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }])
      const result = addOutgoingEdge(node, 'node2')

      expect(result.outgoingEdges).toEqual([{ targetId: 'node2', label: '' }])
    })

    it('should not mutate the original node', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }])
      const originalEdges = [...node.outgoingEdges]

      addOutgoingEdge(node, 'node3')

      expect(node.outgoingEdges).toEqual(originalEdges)
    })
  })

  describe('removeOutgoingEdge', () => {
    it('should remove an edge from a node', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
      const result = removeOutgoingEdge(node, 'node2')

      expect(result.outgoingEdges).toEqual([{ targetId: 'node3', label: '' }])
    })

    it('should handle removing non-existent edge', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }])
      const result = removeOutgoingEdge(node, 'node3')

      expect(result.outgoingEdges).toEqual([{ targetId: 'node2', label: '' }])
    })

    it('should handle removing from empty edges', () => {
      const node = createTestNode('node1', [])
      const result = removeOutgoingEdge(node, 'node2')

      expect(result.outgoingEdges).toEqual([])
    })

    it('should not mutate the original node', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
      const originalEdges = [...node.outgoingEdges]

      removeOutgoingEdge(node, 'node2')

      expect(node.outgoingEdges).toEqual(originalEdges)
    })
  })

  describe('removeOutgoingEdges', () => {
    it('should remove multiple edges from a node', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }, { targetId: 'node4', label: '' }])
      const result = removeOutgoingEdges(node, ['node2', 'node4'])

      expect(result.outgoingEdges).toEqual([{ targetId: 'node3', label: '' }])
    })

    it('should handle removing non-existent edges', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }])
      const result = removeOutgoingEdges(node, ['node3', 'node4'])

      expect(result.outgoingEdges).toEqual([{ targetId: 'node2', label: '' }])
    })

    it('should handle empty removal list', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
      const result = removeOutgoingEdges(node, [])

      expect(result.outgoingEdges).toEqual([{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
    })

    it('should not mutate the original node', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
      const originalEdges = [...node.outgoingEdges]

      removeOutgoingEdges(node, ['node2'])

      expect(node.outgoingEdges).toEqual(originalEdges)
    })
  })

  describe('setOutgoingEdges', () => {
    it('should replace all edges with new set', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
      const result = setOutgoingEdges(node, [{ targetId: 'node4', label: '' }, { targetId: 'node5', label: '' }])

      expect(result.outgoingEdges).toEqual([{ targetId: 'node4', label: '' }, { targetId: 'node5', label: '' }])
    })

    it('should set edges on empty node', () => {
      const node = createTestNode('node1', [])
      const result = setOutgoingEdges(node, [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])

      expect(result.outgoingEdges).toEqual([{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
    })

    it('should handle setting empty edges', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }, { targetId: 'node3', label: '' }])
      const result = setOutgoingEdges(node, [])

      expect(result.outgoingEdges).toEqual([])
    })

    it('should not mutate the original node', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }])
      const originalEdges = [...node.outgoingEdges]

      setOutgoingEdges(node, [{ targetId: 'node3', label: '' }])

      expect(node.outgoingEdges).toEqual(originalEdges)
    })

    it('should preserve other node properties', () => {
      const node = createTestNode('node1', [{ targetId: 'node2', label: '' }])
      const result = setOutgoingEdges(node, [{ targetId: 'node3', label: '' }])

      expect(result.relativeFilePathIsID).toBe('node1')
      expect(result.contentWithoutYamlOrLinks).toBe('test content')
      expect(result.nodeUIMetadata).toEqual(node.nodeUIMetadata)
    })
  })
})
