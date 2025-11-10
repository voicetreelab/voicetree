import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { extractLinkedNodeIds } from '@/functional_graph/pure/markdown-parsing/extract-linked-node-ids.ts'
import type { GraphNode } from '@/functional_graph/pure/types.ts'

describe('extractLinkedNodeIds', () => {
  const createNode = (id: string, content = ''): GraphNode => ({
    relativeFilePathIsID: id,
    content,
    outgoingEdges: [],
    nodeUIMetadata: {
      color: O.none,
      position: O.none
    }
  })

  it('should extract linked node IDs by node ID', () => {
    const content = 'See [[1]] and [[2]]'
    const nodes = {
      '1': createNode('1'),
      '2': createNode('2'),
      '3': createNode('3')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1', '2'])
  })

  it('should extract linked node IDs by filename', () => {
    const content = 'See [[node-a.md]] and [[node-b.md]]'
    const nodes = {
      'node-a': createNode('node-a'),
      'node-b': createNode('node-b')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['node-a', 'node-b'])
  })

  it('should return empty array when no wikilinks found', () => {
    const content = 'Just plain text with no links'
    const nodes = {
      '1': createNode('1')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual([])
  })

  it('should ignore unresolved wikilinks', () => {
    const content = 'See [[1]] and [[non-existent]]'
    const nodes = {
      '1': createNode('1')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1'])
  })

  it('should remove duplicate links', () => {
    const content = 'See [[1]] and [[2]] and [[1]] again'
    const nodes = {
      '1': createNode('1'),
      '2': createNode('2')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1', '2'])
  })

  it('should preserve link order with duplicates removed', () => {
    const content = '[[3]] then [[1]] then [[2]] then [[1]]'
    const nodes = {
      '1': createNode('1'),
      '2': createNode('2'),
      '3': createNode('3')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['3', '1', '2'])
  })

  it('should handle multiple links in same line', () => {
    const content = 'Multiple links: [[1]] [[2]] [[3]]'
    const nodes = {
      '1': createNode('1'),
      '2': createNode('2'),
      '3': createNode('3')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1', '2', '3'])
  })

  it('should handle links across multiple lines', () => {
    const content = `Line 1 with [[1]]
Line 2 with [[2]]
Line 3 with [[3]]`
    const nodes = {
      '1': createNode('1'),
      '2': createNode('2'),
      '3': createNode('3')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1', '2', '3'])
  })

  it('should trim whitespace in link text', () => {
    const content = 'See [[  1  ]] with extra spaces'
    const nodes = {
      '1': createNode('1')
    }

    const result = extractLinkedNodeIds(content, nodes)

    expect(result).toEqual(['1'])
  })

  it('should handle empty nodes record', () => {
    const content = 'See [[GraphNode A]]'
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

  describe('path matching edge cases', () => {
    it('should match absolute paths to node IDs, preferring longer matches', () => {
      const content = 'See [[/Users/bobbobby/repos/vaults/vscode_spike/_179.md]]'
      const nodes = {
        '_179': createNode('_179'),
        'vscode_spike/_179': createNode('vscode_spike/_179')
      }

      const result = extractLinkedNodeIds(content, nodes)

      // Prefers longer match (vscode_spike/_179) over shorter (_179) for better specificity
      expect(result).toEqual(['vscode_spike/_179'])
    })

    it('should match absolute paths with partial path overlap', () => {
      const content = 'Link to [[/Users/bobbobby/repos/vaults/vscode_spike/_179.md]]'
      const nodes = {
        'vscode_spike/_179': createNode('vscode_spike/_179')
      }

      const result = extractLinkedNodeIds(content, nodes)

      expect(result).toEqual(['vscode_spike/_179'])
    })

    it('should handle relative paths from different bases', () => {
      const content = 'See [[../other_folder/node.md]] and [[./subfolder/node2.md]]'
      const nodes = {
        'other_folder/node': createNode('other_folder/node'),
        'subfolder/node2': createNode('subfolder/node2')
      }

      const result = extractLinkedNodeIds(content, nodes)

      expect(result).toEqual(['other_folder/node', 'subfolder/node2'])
    })

    it('should match paths with different levels of specificity, preferring longest match', () => {
      const content = 'Link to [[/full/path/to/vault/folder/file.md]]'
      const nodes = {
        'file': createNode('file'),
        'folder/file': createNode('folder/file'),
        'vault/folder/file': createNode('vault/folder/file')
      }

      const result = extractLinkedNodeIds(content, nodes)

      // Prefers 'vault/folder/file' over 'folder/file' over 'file'
      expect(result).toEqual(['vault/folder/file'])
    })

    it('should handle absolute paths without extensions, preferring longer match', () => {
      const content = 'See [[/Users/bobbobby/repos/vaults/project/_179]]'
      const nodes = {
        '_179': createNode('_179'),
        'project/_179': createNode('project/_179')
      }

      const result = extractLinkedNodeIds(content, nodes)

      // Prefers longer match with more path context
      expect(result).toEqual(['project/_179'])
    })

    it('should match relative paths that resolve to same file', () => {
      const content = 'Multiple refs: [[../../vault/note.md]] [[../vault/note.md]] [[vault/note.md]]'
      const nodes = {
        'vault/note': createNode('vault/note')
      }

      const result = extractLinkedNodeIds(content, nodes)

      // All three relative paths should resolve to the same node
      expect(result).toEqual(['vault/note'])
    })

    it('should handle paths with special characters', () => {
      const content = 'Link to [[/path/to/node_with-special.chars.md]]'
      const nodes = {
        'node_with-special.chars': createNode('node_with-special.chars')
      }

      const result = extractLinkedNodeIds(content, nodes)

      expect(result).toEqual(['node_with-special.chars'])
    })

    it('should prioritize longer path matches over shorter ones', () => {
      const content = 'See [[/full/absolute/path/to/deeply/nested/file.md]]'
      const nodes = {
        'file': createNode('file'),
        'nested/file': createNode('nested/file'),
        'deeply/nested/file': createNode('deeply/nested/file')
      }

      const result = extractLinkedNodeIds(content, nodes)

      // Prefers 'deeply/nested/file' over 'nested/file' over 'file'
      // The longer match provides more specificity and reduces ambiguity
      expect(result).toEqual(['deeply/nested/file'])
    })

    it('should handle mixed absolute and relative paths in same content', () => {
      const content = `
        Absolute: [[/Users/user/vault/folder/_179.md]]
        Relative parent: [[../folder/_179.md]]
        Relative current: [[./folder/_179.md]]
        Just filename: [[_179.md]]
      `
      const nodes = {
        'folder/_179': createNode('folder/_179')
      }

      const result = extractLinkedNodeIds(content, nodes)

      // All paths should resolve to the same node (after proper path resolution)
      expect(result).toEqual(['folder/_179'])
    })

    it('should handle ambiguous matches with same filename in different folders', () => {
      const content = 'Link to [[README.md]]'
      const nodes = {
        'README': createNode('README'),
        'docs/README': createNode('docs/README'),
        'src/README': createNode('src/README')
      }

      const result = extractLinkedNodeIds(content, nodes)

      // When only filename is provided, matches the shortest path (root-level preferred)
      // This is because extractPathSegments returns ['README'] and it matches 'README' node first
      expect(result).toEqual(['README'])
    })
  })
})
