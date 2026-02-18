/**
 * Integration tests for wikilink resolution WITHOUT .md extension.
 *
 * These tests verify that [[node-name]] (without .md) resolves correctly
 * across the full read pipeline: edge extraction, link matching, index lookup,
 * write-path duplicate detection, and placeholder replacement.
 *
 * TDD: Tests written FIRST — expect some to fail until code changes land.
 */
import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {
  extractEdges,
  findBestMatchingNode,
  linkMatchScore,
  getPathComponents
} from '@/pure/graph/markdown-parsing/extract-edges'
import {
  getBaseName,
  buildNodeByBaseNameIndex
} from '@/pure/graph/graph-operations/linkResolutionIndexes'
import type { NodeByBaseNameIndex } from '@/pure/graph/graph-operations/linkResolutionIndexes'
import { fromNodeToContentWithWikilinks } from '@/pure/graph/markdown-writing/node_to_markdown'
import { replaceWikilinkPlaceholders } from '@/pure/graph/rename/replaceWikilinkPlaceholders'
import type { GraphNode, Edge } from '@/pure/graph'

const createNode: (id: string, content?: string, edges?: readonly { readonly targetId: string; readonly label: string }[]) => GraphNode =
  (id: string, content: string = '', edges: readonly { readonly targetId: string; readonly label: string }[] = []): GraphNode => ({
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    outgoingEdges: edges,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

describe('wikilink without .md extension — integration tests', () => {

  // ─── Scenario 1: Edge extraction without .md ───────────────────────
  describe('1. Edge extraction: [[node-name]] (no .md) resolves to folder/node-name.md', () => {
    it('should resolve [[node-name]] to folder/node-name.md', () => {
      const content: string = 'Progress on [[node-name]]'
      const nodes: Record<string, GraphNode> = {
        'folder/node-name.md': createNode('folder/node-name.md')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'folder/node-name.md', label: 'Progress on' }
      ])
    })

    it('should resolve [[my-doc]] to my-doc.md at root level', () => {
      const content: string = 'See [[my-doc]]'
      const nodes: Record<string, GraphNode> = {
        'my-doc.md': createNode('my-doc.md')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'my-doc.md', label: 'See' }
      ])
    })
  })

  // ─── Scenario 2: Edge extraction with subfolder path (no .md) ──────
  describe('2. Edge extraction with subfolder: [[sub/node]] resolves to sub/node.md', () => {
    it('should resolve [[sub/node]] to sub/node.md', () => {
      const content: string = 'Link to [[sub/node]]'
      const nodes: Record<string, GraphNode> = {
        'sub/node.md': createNode('sub/node.md')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'sub/node.md', label: 'Link to' }
      ])
    })

    it('should resolve [[deep/path/doc]] to deep/path/doc.md', () => {
      const content: string = 'Ref [[deep/path/doc]]'
      const nodes: Record<string, GraphNode> = {
        'deep/path/doc.md': createNode('deep/path/doc.md')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'deep/path/doc.md', label: 'Ref' }
      ])
    })
  })

  // ─── Scenario 3: linkMatchScore with extension-less link ───────────
  describe('3. linkMatchScore: extension-less link vs .md node', () => {
    it('linkMatchScore("node-name", "folder/node-name.md") should return 1', () => {
      expect(linkMatchScore('node-name', 'folder/node-name.md')).toBe(1)
    })

    it('linkMatchScore("sub/node", "sub/node.md") should return 2', () => {
      expect(linkMatchScore('sub/node', 'sub/node.md')).toBe(2)
    })

    it('linkMatchScore("node", "node.md") should return 1', () => {
      expect(linkMatchScore('node', 'node.md')).toBe(1)
    })

    it('linkMatchScore("a/b/c", "a/b/c.md") should return 3', () => {
      expect(linkMatchScore('a/b/c', 'a/b/c.md')).toBe(3)
    })
  })

  // ─── Scenario 4: findBestMatchingNode with basename only ───────────
  describe('4. findBestMatchingNode: basename without .md', () => {
    it('should find folder/node-name.md from "node-name"', () => {
      const nodes: Record<string, GraphNode> = {
        'folder/node-name.md': createNode('folder/node-name.md'),
        'folder/other.md': createNode('folder/other.md')
      }

      expect(findBestMatchingNode('node-name', nodes)).toBe('folder/node-name.md')
    })

    it('should find root-level node.md from "node"', () => {
      const nodes: Record<string, GraphNode> = {
        'node.md': createNode('node.md')
      }

      expect(findBestMatchingNode('node', nodes)).toBe('node.md')
    })
  })

  // ─── Scenario 5: findBestMatchingNode with path (no .md) ──────────
  describe('5. findBestMatchingNode with path: "sub/node" finds sub/node.md', () => {
    it('should find sub/node.md from "sub/node"', () => {
      const nodes: Record<string, GraphNode> = {
        'sub/node.md': createNode('sub/node.md'),
        'other/node.md': createNode('other/node.md')
      }

      expect(findBestMatchingNode('sub/node', nodes)).toBe('sub/node.md')
    })

    it('should prefer longer path match when extension-less', () => {
      const nodes: Record<string, GraphNode> = {
        'node.md': createNode('node.md'),
        'sub/node.md': createNode('sub/node.md'),
        'deep/sub/node.md': createNode('deep/sub/node.md')
      }

      expect(findBestMatchingNode('sub/node', nodes)).toBe('sub/node.md')
    })
  })

  // ─── Scenario 6: nodeByBaseName index resolves extension-less ──────
  describe('6. nodeByBaseName index: [[node]] resolves to node.md via getBaseName', () => {
    it('getBaseName should strip .md and return lowercase basename', () => {
      expect(getBaseName('folder/MyNode.md')).toBe('mynode')
      expect(getBaseName('MyNode.md')).toBe('mynode')
    })

    it('getBaseName should handle input WITHOUT .md extension', () => {
      expect(getBaseName('node')).toBe('node')
      expect(getBaseName('folder/node')).toBe('node')
      expect(getBaseName('Node')).toBe('node')
    })

    it('buildNodeByBaseNameIndex should allow lookup from extension-less link', () => {
      const nodes: Record<string, GraphNode> = {
        'folder/my-node.md': createNode('folder/my-node.md')
      }

      const index: NodeByBaseNameIndex = buildNodeByBaseNameIndex(nodes)

      const basename: string = getBaseName('my-node')
      expect(index.get(basename)).toEqual(['folder/my-node.md'])
    })

    it('findBestMatchingNode should use index for extension-less lookup', () => {
      const nodes: Record<string, GraphNode> = {
        'folder/target.md': createNode('folder/target.md'),
        'other/unrelated.md': createNode('other/unrelated.md')
      }
      const index: NodeByBaseNameIndex = buildNodeByBaseNameIndex(nodes)

      expect(findBestMatchingNode('target', nodes, index)).toBe('folder/target.md')
    })
  })

  // ─── Scenario 7: Write path duplicate detection ────────────────────
  describe('7. Duplicate detection: [[foo]] covers edge to folder/foo.md', () => {
    it('should NOT append duplicate wikilink when content has [[foo]] and edge targets folder/foo.md', () => {
      const node: GraphNode = createNode(
        'source.md',
        'Progress on [foo]*',
        [{ targetId: 'folder/foo.md', label: 'Progress on' }]
      )

      const result: string = fromNodeToContentWithWikilinks(node)

      expect(result).toBe('Progress on [[foo]]')
      expect(result).not.toContain('[[folder/foo.md]]')
    })

    it('should NOT append duplicate when content has [[sub/doc]] and edge targets sub/doc.md', () => {
      const node: GraphNode = createNode(
        'source.md',
        'See [sub/doc]*',
        [{ targetId: 'sub/doc.md', label: 'See' }]
      )

      const result: string = fromNodeToContentWithWikilinks(node)

      expect(result).toBe('See [[sub/doc]]')
      expect(result).not.toContain('[[sub/doc.md]]')
    })

    it('should still append genuinely missing edges', () => {
      const node: GraphNode = createNode(
        'source.md',
        'Some content',
        [{ targetId: 'folder/new-edge.md', label: '' }]
      )

      const result: string = fromNodeToContentWithWikilinks(node)

      expect(result).toContain('[[folder/new-edge.md]]')
    })
  })

  // ─── Scenario 8: Placeholder replacement ───────────────────────────
  describe('8. Placeholder replacement: [foo]* matches when renaming folder/foo.md', () => {
    it('should replace [foo]* when renaming folder/foo.md to folder/bar.md', () => {
      const content: string = 'Progress on [foo]*'
      const result: string = replaceWikilinkPlaceholders(content, 'folder/foo.md', 'folder/bar.md')

      expect(result).toBe('Progress on [bar]*')
    })

    it('should replace [sub/doc]* when renaming sub/doc.md', () => {
      const content: string = 'See [sub/doc]*'
      const result: string = replaceWikilinkPlaceholders(content, 'sub/doc.md', 'sub/renamed.md')

      expect(result).toBe('See [renamed]*')
    })

    it('should NOT replace [unrelated]* when renaming folder/foo.md', () => {
      const content: string = 'Link to [unrelated]*'
      const result: string = replaceWikilinkPlaceholders(content, 'folder/foo.md', 'folder/bar.md')

      expect(result).toBe('Link to [unrelated]*')
    })
  })

  // ─── Cross-cutting: getPathComponents normalizes extension-less ────
  describe('getPathComponents normalizes extension-less links', () => {
    it('should return same components for "node" and "node.md"', () => {
      expect(getPathComponents('node')).toEqual(['node'])
      expect(getPathComponents('node.md')).toEqual(['node'])
    })

    it('should return same components for "sub/node" and "sub/node.md"', () => {
      expect(getPathComponents('sub/node')).toEqual(['sub', 'node'])
      expect(getPathComponents('sub/node.md')).toEqual(['sub', 'node'])
    })
  })
})
