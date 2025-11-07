import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { extractLinkedNodeIds } from '@/functional_graph/pure/markdown_parsing/extract-linked-node-ids'
import type { GraphNode } from '@/functional_graph/pure/types'

describe('extractLinkedNodeIds', () => {
  const createNode = (id: string): GraphNode => ({
    relativeFilePathIsID: id,
    content: '',
    outgoingEdges: [],
    nodeUIMetadata: {
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

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['node-a', 'node-b'])
  })

  it('should extract linked node IDs by filename with .md extension', () => {
    const content = 'See [[node-a.md]] and [[node-b.md]]'
    const nodes = {
      'node-a': createNode('node-a'),
      'node-b': createNode('node-b')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['node-a', 'node-b'])
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

    const result = extractLinkedNodeIds(content, nodes)

    // EXPECTED: Should resolve to ['_179']
    // ACTUAL: Returns [] because ./ prefix is not stripped
    expect(result).toEqual(['_179'])
  })

  it('should handle multiple link formats with ./ prefix', () => {
    // Additional test case for the ./ prefix bug
    const content = 'Links: [[./node-a.md]] and [[./node-b.md]] and [[node-c.md]]'
    const nodes = {
      'node-a': createNode('node-a'),
      'node-b': createNode('node-b'),
      'node-c': createNode('node-c')
    }

    const result = extractLinkedNodeIds(content, nodes)

    // Should resolve all three links
    expect(result).toEqual(['node-a', 'node-b', 'node-c'])
  })

  it('should return empty array when no wikilinks found', () => {
    const content = 'Just plain text with no links'
    const nodes = {
      'node-a': createNode('node-a')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual([])
  })

  it('should ignore unresolved wikilinks', () => {
    const content = 'See [[node-a]] and [[non-existent-node]]'
    const nodes = {
      'node-a': createNode('node-a')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['node-a'])
  })

  it('should remove duplicate links', () => {
    const content = 'See [[node-a]] and [[node-b]] and [[node-a]] again'
    const nodes = {
      'node-a': createNode('node-a'),
      'node-b': createNode('node-b')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['node-a', 'node-b'])
  })

  it('should trim whitespace in link text', () => {
    const content = 'See [[  node-a  ]] with extra spaces'
    const nodes = {
      'node-a': createNode('node-a')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['node-a'])
  })

  it('should handle empty nodes record', () => {
    const content = 'See [[node-a]]'
    const nodes = {}

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual([])
  })
})
