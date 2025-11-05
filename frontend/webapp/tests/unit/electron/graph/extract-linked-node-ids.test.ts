import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { extractLinkedNodeIds } from '../../../../src/functional_graph/pure/markdown_parsing/extract-linked-node-ids'
import type { Node } from '../../../../src/functional_graph/pure/types'

describe('extractLinkedNodeIds', () => {
  const createNode = (id: string, title: string): Node => ({
    idAndFilePath: id,
    title,
    content: '',
    summary: '',
    color: O.none
  })

  it('should extract linked node IDs by title', () => {
    const content = 'See [[Node A]] and [[Node B]]'
    const nodes = {
      '1': createNode('1', 'Node A'),
      '2': createNode('2', 'Node B'),
      '3': createNode('3', 'Node C')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1', '2'])
  })

  it('should extract linked node IDs by filename', () => {
    const content = 'See [[node-a.md]] and [[node-b.md]]'
    const nodes = {
      'node-a': createNode('node-a', 'Node A'),
      'node-b': createNode('node-b', 'Node B')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['node-a', 'node-b'])
  })

  it('should return empty array when no wikilinks found', () => {
    const content = 'Just plain text with no links'
    const nodes = {
      '1': createNode('1', 'Node A')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual([])
  })

  it('should ignore unresolved wikilinks', () => {
    const content = 'See [[Node A]] and [[Non-Existent Node]]'
    const nodes = {
      '1': createNode('1', 'Node A')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1'])
  })

  it('should remove duplicate links', () => {
    const content = 'See [[Node A]] and [[Node B]] and [[Node A]] again'
    const nodes = {
      '1': createNode('1', 'Node A'),
      '2': createNode('2', 'Node B')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1', '2'])
  })

  it('should preserve link order with duplicates removed', () => {
    const content = '[[Node C]] then [[Node A]] then [[Node B]] then [[Node A]]'
    const nodes = {
      '1': createNode('1', 'Node A'),
      '2': createNode('2', 'Node B'),
      '3': createNode('3', 'Node C')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['3', '1', '2'])
  })

  it('should handle multiple links in same line', () => {
    const content = 'Multiple links: [[Node A]] [[Node B]] [[Node C]]'
    const nodes = {
      '1': createNode('1', 'Node A'),
      '2': createNode('2', 'Node B'),
      '3': createNode('3', 'Node C')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1', '2', '3'])
  })

  it('should handle links across multiple lines', () => {
    const content = `Line 1 with [[Node A]]
Line 2 with [[Node B]]
Line 3 with [[Node C]]`
    const nodes = {
      '1': createNode('1', 'Node A'),
      '2': createNode('2', 'Node B'),
      '3': createNode('3', 'Node C')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1', '2', '3'])
  })

  it('should trim whitespace in link text', () => {
    const content = 'See [[  Node A  ]] with extra spaces'
    const nodes = {
      '1': createNode('1', 'Node A')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1'])
  })

  it('should handle empty nodes record', () => {
    const content = 'See [[Node A]]'
    const nodes = {}

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual([])
  })

  it('should handle content with no links and empty nodes', () => {
    const content = 'Just plain text'
    const nodes = {}

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual([])
  })
})
