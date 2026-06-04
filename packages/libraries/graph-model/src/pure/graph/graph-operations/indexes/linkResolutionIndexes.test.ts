import { describe, it, expect } from 'vitest'
import {
  buildNodeByBaseNameIndex,
  buildUnresolvedLinksIndex,
  updateNodeByBaseNameIndexForUpsert,
  updateNodeByBaseNameIndexForDelete,
  updateUnresolvedLinksIndexForUpsert,
  updateUnresolvedLinksIndexForDelete,
  getMarkdownLinkTargetBasename
} from './linkResolutionIndexes'
import type { NodeByBaseNameIndex, UnresolvedLinksIndex } from './linkResolutionIndexes'
import type { GraphNode, Edge, NodeIdAndFilePath } from '../..'
import * as O from 'fp-ts/lib/Option.js'

const createTestNode: (id: string, edges?: readonly Edge[]) => GraphNode = (id: string, edges: readonly Edge[] = []): GraphNode => ({
        kind: 'leaf',
        absoluteFilePathIsID: id,
  outgoingEdges: edges,
  contentWithoutYamlOrLinks: 'test content',
  nodeUIMetadata: {
    color: O.none,
    position: O.none,
    additionalYAMLProps: {},
    isContextNode: false
  }
})

describe('getMarkdownLinkTargetBasename', () => {
  it('should extract basename from absolute path', () => {
    expect(getMarkdownLinkTargetBasename('/project/a/foo.md')).toBe('foo')
  })

  it('should extract basename from relative path', () => {
    expect(getMarkdownLinkTargetBasename('./foo.md')).toBe('foo')
    expect(getMarkdownLinkTargetBasename('../bar/foo.md')).toBe('foo')
  })

  it('should handle paths without .md extension', () => {
    expect(getMarkdownLinkTargetBasename('/project/foo')).toBe('foo')
  })

  it('should handle simple filenames', () => {
    expect(getMarkdownLinkTargetBasename('foo.md')).toBe('foo')
    expect(getMarkdownLinkTargetBasename('foo')).toBe('foo')
  })

  it('should ignore empty, current-directory, and parent-directory segments', () => {
    expect(getMarkdownLinkTargetBasename('')).toBe('')
    expect(getMarkdownLinkTargetBasename('./')).toBe('')
    expect(getMarkdownLinkTargetBasename('../')).toBe('')
    expect(getMarkdownLinkTargetBasename('./.././Note.md')).toBe('note')
  })

  it('should only strip a terminal markdown extension', () => {
    expect(getMarkdownLinkTargetBasename('/project/archive.md.backup')).toBe('archive.md.backup')
  })

  it('should return lowercase basename', () => {
    expect(getMarkdownLinkTargetBasename('/project/FooBar.md')).toBe('foobar')
    expect(getMarkdownLinkTargetBasename('README.md')).toBe('readme')
  })
})

describe('nodeByBaseNameIndex', () => {
  describe('buildNodeByBaseNameIndex', () => {
    it('should build index mapping basenames to node IDs', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/a/foo.md': createTestNode('/project/a/foo.md'),
        '/project/b/bar.md': createTestNode('/project/b/bar.md')
      }

      const index: NodeByBaseNameIndex = buildNodeByBaseNameIndex(nodes)

      expect(index.get('foo')).toEqual(['/project/a/foo.md'])
      expect(index.get('bar')).toEqual(['/project/b/bar.md'])
    })

    it('should handle multiple nodes with same basename', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/a/foo.md': createTestNode('/project/a/foo.md'),
        '/project/b/foo.md': createTestNode('/project/b/foo.md'),
        '/project/c/foo.md': createTestNode('/project/c/foo.md')
      }

      const index: NodeByBaseNameIndex = buildNodeByBaseNameIndex(nodes)

      const fooNodes: readonly NodeIdAndFilePath[] | undefined = index.get('foo')
      expect(fooNodes).toHaveLength(3)
      expect(fooNodes).toContain('/project/a/foo.md')
      expect(fooNodes).toContain('/project/b/foo.md')
      expect(fooNodes).toContain('/project/c/foo.md')
    })

    it('should return empty map for empty nodes', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {}
      const index: NodeByBaseNameIndex = buildNodeByBaseNameIndex(nodes)
      expect(index.size).toBe(0)
    })

    it('should not index nodes whose path has no basename', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '': createTestNode(''),
        '../': createTestNode('../')
      }

      const index: NodeByBaseNameIndex = buildNodeByBaseNameIndex(nodes)

      expect(index.size).toBe(0)
    })

    it('should normalize basenames to lowercase', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/README.md': createTestNode('/project/README.md'),
        '/project/Readme.md': createTestNode('/project/Readme.md')
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
      const newNode: GraphNode = createTestNode('/project/foo.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForUpsert(index, newNode, O.none)

      expect(newIndex.get('foo')).toEqual(['/project/foo.md'])
    })

    it('should handle update without changing basename', () => {
      const index: NodeByBaseNameIndex = new Map([['foo', ['/project/foo.md']]])
      const previousNode: GraphNode = createTestNode('/project/foo.md')
      const newNode: GraphNode = createTestNode('/project/foo.md', [{ targetId: 'bar', label: '' }])

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForUpsert(index, newNode, O.some(previousNode))

      // Should still have the same entry
      expect(newIndex.get('foo')).toEqual(['/project/foo.md'])
    })

    it('should handle rename (different path = different basename)', () => {
      // Note: In practice, renames are handled as delete + create, not upsert
      // But we still test the case where previousNode has different path
      const index: NodeByBaseNameIndex = new Map([['oldname', ['/project/oldname.md']]])
      const previousNode: GraphNode = createTestNode('/project/oldname.md')
      const newNode: GraphNode = createTestNode('/project/newname.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForUpsert(index, newNode, O.some(previousNode))

      expect(newIndex.get('oldname')).toBeUndefined()
      expect(newIndex.get('newname')).toEqual(['/project/newname.md'])
    })

    it('should add to existing basename list for collision', () => {
      const index: NodeByBaseNameIndex = new Map([['foo', ['/project/a/foo.md']]])
      const newNode: GraphNode = createTestNode('/project/b/foo.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForUpsert(index, newNode, O.none)

      const fooNodes: readonly NodeIdAndFilePath[] | undefined = newIndex.get('foo')
      expect(fooNodes).toHaveLength(2)
      expect(fooNodes).toContain('/project/a/foo.md')
      expect(fooNodes).toContain('/project/b/foo.md')
    })

    it('should not mutate the input index when adding to a colliding basename', () => {
      // The updater shallow-copies the index and shares value arrays; adding a colliding
      // entry must replace the array, not push into the shared original.
      const fooNodes: readonly NodeIdAndFilePath[] = ['/project/a/foo.md']
      const index: NodeByBaseNameIndex = new Map([['foo', fooNodes]])
      const newNode: GraphNode = createTestNode('/project/b/foo.md')

      updateNodeByBaseNameIndexForUpsert(index, newNode, O.none)

      // Original index and its array must be untouched (shallow-copy correctness).
      expect(index.get('foo')).toEqual(['/project/a/foo.md'])
      expect(fooNodes).toEqual(['/project/a/foo.md'])
    })
  })

  describe('updateNodeByBaseNameIndexForDelete', () => {
    it('should remove node from index', () => {
      const index: NodeByBaseNameIndex = new Map([['foo', ['/project/foo.md']]])
      const deletedNode: GraphNode = createTestNode('/project/foo.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForDelete(index, deletedNode)

      expect(newIndex.get('foo')).toBeUndefined()
    })

    it('should preserve other nodes with same basename', () => {
      const index: NodeByBaseNameIndex = new Map([['foo', ['/project/a/foo.md', '/project/b/foo.md']]])
      const deletedNode: GraphNode = createTestNode('/project/a/foo.md')

      const newIndex: NodeByBaseNameIndex = updateNodeByBaseNameIndexForDelete(index, deletedNode)

      expect(newIndex.get('foo')).toEqual(['/project/b/foo.md'])
    })

    it('should handle delete of non-existent node gracefully', () => {
      const index: NodeByBaseNameIndex = new Map()
      const deletedNode: GraphNode = createTestNode('/project/foo.md')

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
        '/project/foo.md': createTestNode('/project/foo.md', [{ targetId: 'bar', label: '' }])
      }

      const index: UnresolvedLinksIndex = buildUnresolvedLinksIndex(nodes)

      // 'bar' is unresolved, so /project/foo.md should be indexed under 'bar'
      expect(index.get('bar')).toEqual(['/project/foo.md'])
    })

    it('should not index resolved links', () => {
      // Node has edge to existing node
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/foo.md': createTestNode('/project/foo.md', [{ targetId: '/project/bar.md', label: '' }]),
        '/project/bar.md': createTestNode('/project/bar.md')
      }

      const index: UnresolvedLinksIndex = buildUnresolvedLinksIndex(nodes)

      // 'bar' should not be in index since it resolves to existing node
      expect(index.get('bar')).toBeUndefined()
    })

    it('should handle multiple nodes with same unresolved link', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/a.md': createTestNode('/project/a.md', [{ targetId: 'missing', label: '' }]),
        '/project/b.md': createTestNode('/project/b.md', [{ targetId: 'missing', label: '' }])
      }

      const index: UnresolvedLinksIndex = buildUnresolvedLinksIndex(nodes)

      const missingNodes: readonly NodeIdAndFilePath[] | undefined = index.get('missing')
      expect(missingNodes).toHaveLength(2)
      expect(missingNodes).toContain('/project/a.md')
      expect(missingNodes).toContain('/project/b.md')
    })

    it('should return empty map when all links are resolved', () => {
      const nodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/foo.md': createTestNode('/project/foo.md', [{ targetId: '/project/bar.md', label: '' }]),
        '/project/bar.md': createTestNode('/project/bar.md')
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
      // There's a dangling link to 'bar', then we add /project/bar.md
      const index: UnresolvedLinksIndex = new Map([['bar', ['/project/foo.md']]])
      const newNode: GraphNode = createTestNode('/project/bar.md')
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/foo.md': createTestNode('/project/foo.md', [{ targetId: 'bar', label: '' }]),
        '/project/bar.md': newNode
      }

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForUpsert(index, newNode, O.none, allNodes)

      // 'bar' should no longer be unresolved
      expect(newIndex.get('bar')).toBeUndefined()
    })

    it('should add new unresolved links from added node', () => {
      const index: UnresolvedLinksIndex = new Map()
      const newNode: GraphNode = createTestNode('/project/foo.md', [{ targetId: 'missing', label: '' }])
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/foo.md': newNode
      }

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForUpsert(index, newNode, O.none, allNodes)

      expect(newIndex.get('missing')).toEqual(['/project/foo.md'])
    })

    it('should handle update that changes edges', () => {
      // Node previously had unresolved link to 'old', now has unresolved link to 'new'
      const index: UnresolvedLinksIndex = new Map([['old', ['/project/foo.md']]])
      const previousNode: GraphNode = createTestNode('/project/foo.md', [{ targetId: 'old', label: '' }])
      const newNode: GraphNode = createTestNode('/project/foo.md', [{ targetId: 'new', label: '' }])
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/foo.md': newNode
      }

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForUpsert(index, newNode, O.some(previousNode), allNodes)

      expect(newIndex.get('old')).toBeUndefined()
      expect(newIndex.get('new')).toEqual(['/project/foo.md'])
    })
  })

  describe('updateUnresolvedLinksIndexForDelete', () => {
    it('should remove deleted node from unresolved links tracking', () => {
      // foo.md had unresolved link to 'missing', now foo.md is deleted
      const index: UnresolvedLinksIndex = new Map([['missing', ['/project/foo.md']]])
      const deletedNode: GraphNode = createTestNode('/project/foo.md', [{ targetId: 'missing', label: '' }])
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {}

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForDelete(index, deletedNode, allNodes)

      expect(newIndex.get('missing')).toBeUndefined()
    })

    it('should add back unresolved links when target is deleted', () => {
      // bar.md exists, foo.md points to it, then bar.md is deleted
      // foo.md edge to bar.md should become unresolved
      const index: UnresolvedLinksIndex = new Map()
      const fooNode: GraphNode = createTestNode('/project/foo.md', [{ targetId: '/project/bar.md', label: '' }])
      const deletedNode: GraphNode = createTestNode('/project/bar.md')
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/foo.md': fooNode
      }

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForDelete(index, deletedNode, allNodes)

      // Edges pointing to deleted node should now be unresolved
      // The basename of '/project/bar.md' is 'bar'
      expect(newIndex.get('bar')).toEqual(['/project/foo.md'])
    })

    it('should preserve other nodes with same unresolved link', () => {
      const index: UnresolvedLinksIndex = new Map([['missing', ['/project/a.md', '/project/b.md']]])
      const deletedNode: GraphNode = createTestNode('/project/a.md', [{ targetId: 'missing', label: '' }])
      const allNodes: Record<NodeIdAndFilePath, GraphNode> = {
        '/project/b.md': createTestNode('/project/b.md', [{ targetId: 'missing', label: '' }])
      }

      const newIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForDelete(index, deletedNode, allNodes)

      expect(newIndex.get('missing')).toEqual(['/project/b.md'])
    })
  })
})
