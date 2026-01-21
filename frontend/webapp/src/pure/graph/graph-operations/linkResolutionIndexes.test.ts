import { describe, it, expect } from 'vitest'
import {
  buildNodeByBaseNameIndex,
  buildUnresolvedLinksIndex,
  updateNodeByBaseNameIndexForUpsert,
  updateNodeByBaseNameIndexForDelete,
  updateUnresolvedLinksIndexForUpsert,
  updateUnresolvedLinksIndexForDelete,
  getBaseName
} from '@/pure/graph/graph-operations/linkResolutionIndexes'
import type { NodeByBaseNameIndex, UnresolvedLinksIndex } from '@/pure/graph/graph-operations/linkResolutionIndexes'
import type { GraphNode, Edge, NodeIdAndFilePath } from '@/pure/graph'
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

describe('getBaseName', () => {
  it('should extract basename from absolute path', () => {
    expect(getBaseName('/vault/a/foo.md')).toBe('foo')
  })

  it('should extract basename from relative path', () => {
    expect(getBaseName('./foo.md')).toBe('foo')
    expect(getBaseName('../bar/foo.md')).toBe('foo')
  })

  it('should handle paths without .md extension', () => {
    expect(getBaseName('/vault/foo')).toBe('foo')
  })

  it('should handle simple filenames', () => {
    expect(getBaseName('foo.md')).toBe('foo')
    expect(getBaseName('foo')).toBe('foo')
  })

  it('should return lowercase basename', () => {
    expect(getBaseName('/vault/FooBar.md')).toBe('foobar')
    expect(getBaseName('README.md')).toBe('readme')
  })
})

describe('nodeByBaseNameIndex', () => {
  describe('buildNodeByBaseNameIndex', () => {
    it('should build index mapping basenames to node IDs', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a/foo.md': createTestNode('/vault/a/foo.md'),
        '/vault/b/bar.md': createTestNode('/vault/b/bar.md')
      }

      const index: NodeByBaseNameIndex = buildNodeByBaseNameIndex(nodes)

      expect(index.get('foo')).toEqual(['/vault/a/foo.md'])
      expect(index.get('bar')).toEqual(['/vault/b/bar.md'])
    })

    it('should handle multiple nodes with same basename', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a/foo.md': createTestNode('/vault/a/foo.md'),
        '/vault/b/foo.md': createTestNode('/vault/b/foo.md'),
        '/vault/c/foo.md': createTestNode('/vault/c/foo.md')
      }

      const index: NodeByBaseNameIndex = buildNodeByBaseNameIndex(nodes)

      const fooNodes: readonly NodeIdAndFilePath[] | undefined = index.get('foo')
      expect(fooNodes).toHaveLength(3)
      expect(fooNodes).toContain('/vault/a/foo.md')
      expect(fooNodes).toContain('/vault/b/foo.md')
      expect(fooNodes).toContain('/vault/c/foo.md')
    })

    it('should return empty map for empty nodes', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {}
      const index: NodeByBaseNameIndex = buildNodeByBaseNameIndex(nodes)
      expect(index.size).toBe(0)
    })

    it('should normalize basenames to lowercase', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/README.md': createTestNode('/vault/README.md'),
        '/vault/Readme.md': createTestNode('/vault/Readme.md')
      }

      const index: NodeByBaseNameIndex = buildNodeByBaseNameIndex(nodes)

      // Both should be under 'readme' key
      const readmeNodes: readonly NodeIdAndFilePath[] | undefined = index.get('readme')
      expect(readmeNodes).toHaveLength(2)
    })
  })

  describe('updateNodeByBaseNameIndexForUpsert', () => {
    it('should add new node to index', () => {
      const index: NodeByBaseNameIndex = new Map()
      const newNode: GraphNode = createTestNode('/vault/foo.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForUpsert(index, newNode, O.none)

      expect(newIndex.get('foo')).toEqual(['/vault/foo.md'])
    })

    it('should handle update without changing basename', () => {
      const index: NodeByBaseNameIndex = new Map([['foo', ['/vault/foo.md']]])
      const previousNode: GraphNode = createTestNode('/vault/foo.md')
      const newNode: GraphNode = createTestNode('/vault/foo.md', [{ targetId: 'bar', label: '' }])

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForUpsert(index, newNode, O.some(previousNode))

      // Should still have the same entry
      expect(newIndex.get('foo')).toEqual(['/vault/foo.md'])
    })

    it('should handle rename (different path = different basename)', () => {
      // Note: In practice, renames are handled as delete + create, not upsert
      // But we still test the case where previousNode has different path
      const index: NodeByBaseNameIndex = new Map([['oldname', ['/vault/oldname.md']]])
      const previousNode: GraphNode = createTestNode('/vault/oldname.md')
      const newNode: GraphNode = createTestNode('/vault/newname.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForUpsert(index, newNode, O.some(previousNode))

      expect(newIndex.get('oldname')).toBeUndefined()
      expect(newIndex.get('newname')).toEqual(['/vault/newname.md'])
    })

    it('should add to existing basename list for collision', () => {
      const index: NodeByBaseNameIndex = new Map([['foo', ['/vault/a/foo.md']]])
      const newNode: GraphNode = createTestNode('/vault/b/foo.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForUpsert(index, newNode, O.none)

      const fooNodes: readonly NodeIdAndFilePath[] | undefined = newIndex.get('foo')
      expect(fooNodes).toHaveLength(2)
      expect(fooNodes).toContain('/vault/a/foo.md')
      expect(fooNodes).toContain('/vault/b/foo.md')
    })
  })

  describe('updateNodeByBaseNameIndexForDelete', () => {
    it('should remove node from index', () => {
      const index: NodeByBaseNameIndex = new Map([['foo', ['/vault/foo.md']]])
      const deletedNode: GraphNode = createTestNode('/vault/foo.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForDelete(index, deletedNode)

      expect(newIndex.get('foo')).toBeUndefined()
    })

    it('should preserve other nodes with same basename', () => {
      const index: NodeByBaseNameIndex = new Map([['foo', ['/vault/a/foo.md', '/vault/b/foo.md']]])
      const deletedNode: GraphNode = createTestNode('/vault/a/foo.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForDelete(index, deletedNode)

      expect(newIndex.get('foo')).toEqual(['/vault/b/foo.md'])
    })

    it('should handle delete of non-existent node gracefully', () => {
      const index: NodeByBaseNameIndex = new Map()
      const deletedNode: GraphNode = createTestNode('/vault/foo.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForDelete(index, deletedNode)

      expect(newIndex.size).toBe(0)
    })
  })
})

describe('unresolvedLinksIndex', () => {
  describe('buildUnresolvedLinksIndex', () => {
    it('should index unresolved links (dangling edges)', () => {
      // Node has edge to 'bar' but 'bar' does not exist in nodes
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/foo.md': createTestNode('/vault/foo.md', [{ targetId: 'bar', label: '' }])
      }

      const index: UnresolvedLinksIndex = buildUnresolvedLinksIndex(nodes)

      // 'bar' is unresolved, so /vault/foo.md should be indexed under 'bar'
      expect(index.get('bar')).toEqual(['/vault/foo.md'])
    })

    it('should not index resolved links', () => {
      // Node has edge to existing node
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/foo.md': createTestNode('/vault/foo.md', [{ targetId: '/vault/bar.md', label: '' }]),
        '/vault/bar.md': createTestNode('/vault/bar.md')
      }

      const index: UnresolvedLinksIndex = buildUnresolvedLinksIndex(nodes)

      // 'bar' should not be in index since it resolves to existing node
      expect(index.get('bar')).toBeUndefined()
    })

    it('should handle multiple nodes with same unresolved link', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/a.md': createTestNode('/vault/a.md', [{ targetId: 'missing', label: '' }]),
        '/vault/b.md': createTestNode('/vault/b.md', [{ targetId: 'missing', label: '' }])
      }

      const index: UnresolvedLinksIndex = buildUnresolvedLinksIndex(nodes)

      const missingNodes: readonly NodeIdAndFilePath[] | undefined = index.get('missing')
      expect(missingNodes).toHaveLength(2)
      expect(missingNodes).toContain('/vault/a.md')
      expect(missingNodes).toContain('/vault/b.md')
    })

    it('should return empty map when all links are resolved', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/foo.md': createTestNode('/vault/foo.md', [{ targetId: '/vault/bar.md', label: '' }]),
        '/vault/bar.md': createTestNode('/vault/bar.md')
      }

      const index: UnresolvedLinksIndex = buildUnresolvedLinksIndex(nodes)

      expect(index.size).toBe(0)
    })

    it('should return empty map for empty nodes', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {}
      const index: UnresolvedLinksIndex = buildUnresolvedLinksIndex(nodes)
      expect(index.size).toBe(0)
    })
  })

  describe('updateUnresolvedLinksIndexForUpsert', () => {
    it('should remove resolved links when new node is added', () => {
      // There's a dangling link to 'bar', then we add /vault/bar.md
      const index: UnresolvedLinksIndex = new Map([['bar', ['/vault/foo.md']]])
      const newNode: GraphNode = createTestNode('/vault/bar.md')
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/foo.md': createTestNode('/vault/foo.md', [{ targetId: 'bar', label: '' }]),
        '/vault/bar.md': newNode
      }

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForUpsert(index, newNode, O.none, allNodes)

      // 'bar' should no longer be unresolved
      expect(newIndex.get('bar')).toBeUndefined()
    })

    it('should add new unresolved links from added node', () => {
      const index: UnresolvedLinksIndex = new Map()
      const newNode: GraphNode = createTestNode('/vault/foo.md', [{ targetId: 'missing', label: '' }])
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/foo.md': newNode
      }

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForUpsert(index, newNode, O.none, allNodes)

      expect(newIndex.get('missing')).toEqual(['/vault/foo.md'])
    })

    it('should handle update that changes edges', () => {
      // Node previously had unresolved link to 'old', now has unresolved link to 'new'
      const index: UnresolvedLinksIndex = new Map([['old', ['/vault/foo.md']]])
      const previousNode: GraphNode = createTestNode('/vault/foo.md', [{ targetId: 'old', label: '' }])
      const newNode: GraphNode = createTestNode('/vault/foo.md', [{ targetId: 'new', label: '' }])
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/foo.md': newNode
      }

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForUpsert(index, newNode, O.some(previousNode), allNodes)

      expect(newIndex.get('old')).toBeUndefined()
      expect(newIndex.get('new')).toEqual(['/vault/foo.md'])
    })
  })

  describe('updateUnresolvedLinksIndexForDelete', () => {
    it('should remove deleted node from unresolved links tracking', () => {
      // foo.md had unresolved link to 'missing', now foo.md is deleted
      const index: UnresolvedLinksIndex = new Map([['missing', ['/vault/foo.md']]])
      const deletedNode: GraphNode = createTestNode('/vault/foo.md', [{ targetId: 'missing', label: '' }])
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {}

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForDelete(index, deletedNode, allNodes)

      expect(newIndex.get('missing')).toBeUndefined()
    })

    it('should add back unresolved links when target is deleted', () => {
      // bar.md exists, foo.md points to it, then bar.md is deleted
      // foo.md edge to bar.md should become unresolved
      const index: UnresolvedLinksIndex = new Map()
      const fooNode: GraphNode = createTestNode('/vault/foo.md', [{ targetId: '/vault/bar.md', label: '' }])
      const deletedNode: GraphNode = createTestNode('/vault/bar.md')
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/foo.md': fooNode
      }

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForDelete(index, deletedNode, allNodes)

      // Edges pointing to deleted node should now be unresolved
      // The basename of '/vault/bar.md' is 'bar'
      expect(newIndex.get('bar')).toEqual(['/vault/foo.md'])
    })

    it('should preserve other nodes with same unresolved link', () => {
      const index: UnresolvedLinksIndex = new Map([['missing', ['/vault/a.md', '/vault/b.md']]])
      const deletedNode: GraphNode = createTestNode('/vault/a.md', [{ targetId: 'missing', label: '' }])
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/vault/b.md': createTestNode('/vault/b.md', [{ targetId: 'missing', label: '' }])
      }

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForDelete(index, deletedNode, allNodes)

      expect(newIndex.get('missing')).toEqual(['/vault/b.md'])
    })
  })
})
