import { describe, it, expect } from 'vitest'
import {
  buildIncomingEdgesIndex,
  updateIndexForUpsert,
  updateIndexForDelete
} from '@/pure/graph/graph-operations/incomingEdgesIndex'
import type { IncomingEdgesIndex } from '@/pure/graph/graph-operations/incomingEdgesIndex'
import type { GraphNode, Edge, NodeIdAndFilePath } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

const createTestNode: (id: string, edges?: readonly Edge[]) => GraphNode = (id: string, edges: readonly Edge[] = []): GraphNode => ({
  relativeFilePathIsID: id,
  outgoingEdges: edges,
  contentWithoutYamlOrLinks: 'test content',
  nodeUIMetadata: {
    color: O.none,
    position: O.none,
    additionalYAMLProps: new Map(),
    isContextNode: false
  }
})

describe('incomingEdgesIndex', () => {
  describe('buildIncomingEdgesIndex', () => {
    it('should build index on graph creation with outgoing edges', () => {
      // Given: a -> b -> c
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'a': createTestNode('a', [{ targetId: 'b', label: '' }]),
        'b': createTestNode('b', [{ targetId: 'c', label: '' }]),
        'c': createTestNode('c', [])
      }

      const index: IncomingEdgesIndex = buildIncomingEdgesIndex(nodes)

      // 'a' has no incomers
      expect(index.get('a')).toBeUndefined()
      // 'b' has incomer 'a'
      expect(index.get('b')).toEqual(['a'])
      // 'c' has incomer 'b'
      expect(index.get('c')).toEqual(['b'])
    })

    it('should handle multiple incomers (fan-in)', () => {
      // Given: a -> c, b -> c
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'a': createTestNode('a', [{ targetId: 'c', label: '' }]),
        'b': createTestNode('b', [{ targetId: 'c', label: '' }]),
        'c': createTestNode('c', [])
      }

      const index: IncomingEdgesIndex = buildIncomingEdgesIndex(nodes)

      // 'c' has incomers 'a' and 'b'
      const incomers: readonly NodeIdAndFilePath[] | undefined = index.get('c')
      expect(incomers).toHaveLength(2)
      expect(incomers).toContain('a')
      expect(incomers).toContain('b')
    })

    it('should return empty map for empty nodes', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {}
      const index: IncomingEdgesIndex = buildIncomingEdgesIndex(nodes)
      expect(index.size).toBe(0)
    })

    it('should handle self-referential edges', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        'a': createTestNode('a', [{ targetId: 'a', label: '' }])
      }

      const index: IncomingEdgesIndex = buildIncomingEdgesIndex(nodes)

      expect(index.get('a')).toEqual(['a'])
    })
  })

  describe('updateIndexForUpsert', () => {
    it('should add incoming references for new node', () => {
      // Initial index: empty
      const index: IncomingEdgesIndex = new Map()

      // Insert node 'a' with edge to 'b'
      const newNode: GraphNode = createTestNode('a', [{ targetId: 'b', label: '' }])

      const newIndex: IncomingEdgesIndex = updateIndexForUpsert(index, newNode, O.none)

      // 'b' should now have incomer 'a'
      expect(newIndex.get('b')).toEqual(['a'])
    })

    it('should update incoming references when node edges change', () => {
      // Initial: a -> b
      const index: IncomingEdgesIndex = new Map([
        ['b', ['a']]
      ])

      const previousNode: GraphNode = createTestNode('a', [{ targetId: 'b', label: '' }])
      // Updated: a -> c (changed edge target from b to c)
      const newNode: GraphNode = createTestNode('a', [{ targetId: 'c', label: '' }])

      const newIndex: IncomingEdgesIndex = updateIndexForUpsert(index, newNode, O.some(previousNode))

      // 'b' should no longer have 'a' as incomer
      expect(newIndex.get('b')).toBeUndefined()
      // 'c' should now have 'a' as incomer
      expect(newIndex.get('c')).toEqual(['a'])
    })

    it('should handle node adding additional edges', () => {
      // Initial: a -> b
      const index: IncomingEdgesIndex = new Map([
        ['b', ['a']]
      ])

      const previousNode: GraphNode = createTestNode('a', [{ targetId: 'b', label: '' }])
      // Updated: a -> b, a -> c
      const newNode: GraphNode = createTestNode('a', [
        { targetId: 'b', label: '' },
        { targetId: 'c', label: '' }
      ])

      const newIndex: IncomingEdgesIndex = updateIndexForUpsert(index, newNode, O.some(previousNode))

      // 'b' should still have 'a' as incomer
      expect(newIndex.get('b')).toEqual(['a'])
      // 'c' should now also have 'a' as incomer
      expect(newIndex.get('c')).toEqual(['a'])
    })

    it('should preserve other nodes incomers when updating', () => {
      // Initial: a -> c, b -> c
      const index: IncomingEdgesIndex = new Map([
        ['c', ['a', 'b']]
      ])

      const previousNode: GraphNode = createTestNode('a', [{ targetId: 'c', label: '' }])
      // Updated: a -> d (a no longer points to c)
      const newNode: GraphNode = createTestNode('a', [{ targetId: 'd', label: '' }])

      const newIndex: IncomingEdgesIndex = updateIndexForUpsert(index, newNode, O.some(previousNode))

      // 'c' should still have 'b' as incomer (but not 'a')
      expect(newIndex.get('c')).toEqual(['b'])
      // 'd' should have 'a' as incomer
      expect(newIndex.get('d')).toEqual(['a'])
    })
  })

  describe('updateIndexForDelete', () => {
    it('should remove references to deleted node', () => {
      // Initial: a -> b, index has b with incomer a
      const index: IncomingEdgesIndex = new Map([
        ['b', ['a']]
      ])

      const deletedNode: GraphNode = createTestNode('a', [{ targetId: 'b', label: '' }])

      const newIndex: IncomingEdgesIndex = updateIndexForDelete(index, deletedNode)

      // 'b' should no longer have 'a' as incomer (entry should be removed if empty)
      expect(newIndex.get('b')).toBeUndefined()
    })

    it('should remove the deleted node from being an incomer entry', () => {
      // Initial: a -> b, b -> c
      const index: IncomingEdgesIndex = new Map([
        ['b', ['a']],
        ['c', ['b']]
      ])

      const deletedNode: GraphNode = createTestNode('b', [{ targetId: 'c', label: '' }])

      const newIndex: IncomingEdgesIndex = updateIndexForDelete(index, deletedNode)

      // Entry for 'b' should be removed (no one points to deleted node anymore matters)
      // But more importantly, 'c' should no longer have 'b' as incomer
      expect(newIndex.get('c')).toBeUndefined()
    })

    it('should preserve other incomers when one is deleted', () => {
      // Initial: a -> c, b -> c
      const index: IncomingEdgesIndex = new Map([
        ['c', ['a', 'b']]
      ])

      const deletedNode: GraphNode = createTestNode('a', [{ targetId: 'c', label: '' }])

      const newIndex: IncomingEdgesIndex = updateIndexForDelete(index, deletedNode)

      // 'c' should still have 'b' as incomer
      expect(newIndex.get('c')).toEqual(['b'])
    })
  })
})
