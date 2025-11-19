import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { extractEdges } from '@/pure/graph/markdown-parsing/extract-edges.ts'
import type { GraphNode } from '@/pure/graph'

describe('extractLinkedNodeIds', () => {
  const createNode = (id: string): GraphNode => ({
    relativeFilePathIsID: id,
    content: '',
    outgoingEdges: [],
    nodeUIMetadata: {
      title: id,
      color: O.none,
      position: O.none
    }
  })

  it('should extract linked node IDs by node ID directly', () => {
    const content = 'See [[node-a]] and [[node-b]]'
    const nodes = {
      'node-a': createNode('node-a'),
      'node-b': createNode('node-b')
    }

    const result = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: 'node-a', label: 'See' },
      { targetId: 'node-b', label: 'See [[node-a]] and' }
    ])
  })

  it('should extract linked node IDs by filename with .md extension', () => {
    const content = 'See [[node-a.md]] and [[node-b.md]]'
    const nodes = {
      'node-a': createNode('node-a'),
      'node-b': createNode('node-b')
    }

    const result = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: 'node-a', label: 'See' },
      { targetId: 'node-b', label: 'See [[node-a.md]] and' }
    ])
  })

  it('should extract linked node IDs with relative path prefix ./', () => {
    // BUG REPRODUCTION: This test documents the bug where links with ./ prefix are not resolved
    // The link [[./_179.md]] should resolve to node ID '_179'
    const content = 'Parent: [[./_179.md]]'
    const nodes = {
      '_179': createNode('_179'),
      '181_Xavier_VS_Code_Integration_Summary_Path_C_Implementation_Analysis': createNode(
        '181_Xavier_VS_Code_Integration_Summary_Path_C_Implementation_Analysis'
      )
    }

    const result = extractEdges(content, nodes)

    expect(result).toEqual([{ targetId: '_179', label: 'Parent:' }])
  })

  it('should handle multiple link formats with ./ prefix', () => {
    // Additional test case for the ./ prefix bug
    const content = 'Links: [[./node-a.md]] and [[./node-b.md]] and [[node-c.md]]'
    const nodes = {
      'node-a': createNode('node-a'),
      'node-b': createNode('node-b'),
      'node-c': createNode('node-c')
    }

    const result = extractEdges(content, nodes)

    // Should resolve all three links
    expect(result).toEqual([
      { targetId: 'node-a', label: 'Links:' },
      { targetId: 'node-b', label: 'Links: [[./node-a.md]] and' },
      { targetId: 'node-c', label: 'Links: [[./node-a.md]] and [[./node-b.md]] and' }
    ])
  })

  it('should return empty array when no wikilinks found', () => {
    const content = 'Just plain text with no links'
    const nodes = {
      'node-a': createNode('node-a')
    }

    const result = extractEdges(content, nodes)

    expect(result).toEqual([])
  })

  it('should preserve unresolved wikilinks for future node creation', () => {
    const content = 'See [[node-a]] and [[non-existent-node]]'
    const nodes = {
      'node-a': createNode('node-a')
    }

    const result = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: 'node-a', label: 'See' },
      { targetId: 'non-existent-node', label: 'See [[node-a]] and' }
    ])
  })

  it('should remove duplicate links', () => {
    const content = 'See [[node-a]] and [[node-b]] and [[node-a]] again'
    const nodes = {
      'node-a': createNode('node-a'),
      'node-b': createNode('node-b')
    }

    const result = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: 'node-a', label: 'See' },
      { targetId: 'node-b', label: 'See [[node-a]] and' }
    ])
  })

  it('should trim whitespace in link text', () => {
    const content = 'See [[  node-a  ]] with extra spaces'
    const nodes = {
      'node-a': createNode('node-a')
    }

    const result = extractEdges(content, nodes)

    expect(result).toEqual([{ targetId: 'node-a', label: 'See' }])
  })

  it('should preserve links even when nodes record is empty', () => {
    const content = 'See [[node-a]]'
    const nodes = {}

    const result = extractEdges(content, nodes)

    expect(result).toEqual([{ targetId: 'node-a', label: 'See' }])
  })

  it('BUG REPRODUCTION: should strip .md extension from wikilinks (integration test scenario)', () => {
    // This test reproduces the exact scenario from the failing integration test:
    // fileWatching.test.ts > "should create edge when appending wikilink WITH .md extension"
    //
    // Expected behavior: [[test-new-file.md]] should create edge to "test-new-file" (without .md)
    // Actual behavior: Edge is created to "test-new-file.md" (with .md)
    //
    // This unit test passes (extractLinkedNodeIds works correctly),
    // so the bug must be in how edges are created from the extracted IDs
    const content = 'See [[test-new-file.md]]'
    const nodes = {
      'test-new-file': createNode('test-new-file')
    }

    const result = extractEdges(content, nodes)

    // Should strip .md extension
    expect(result).toEqual([{ targetId: 'test-new-file', label: 'See' }])
  })
})
