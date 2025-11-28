import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { extractEdges } from '@/pure/graph/markdown-parsing/extract-edges'
import type { GraphNode, Edge } from '@/pure/graph'

describe('extractLinkedNodeIds', () => {
  const createNode: (id: string, content?: string) => GraphNode = (id: string, content = ''): GraphNode => ({
    relativeFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    outgoingEdges: [],
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  it('should extract linked node IDs by node ID', () => {
    const content: "See [[1]] and [[2]]" = 'See [[1]] and [[2]]'
    const nodes: { readonly '1': GraphNode; readonly '2': GraphNode; readonly '3': GraphNode; } = {
      '1': createNode('1'),
      '2': createNode('2'),
      '3': createNode('3')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: '1', label: 'See' },
      { targetId: '2', label: 'See [[1]] and' }
    ])
  })

  it('should extract linked node IDs by filename', () => {
    const content: "See [[node-a.md]] and [[node-b.md]]" = 'See [[node-a.md]] and [[node-b.md]]'
    const nodes: { readonly 'node-a': GraphNode; readonly 'node-b': GraphNode; } = {
      'node-a': createNode('node-a'),
      'node-b': createNode('node-b')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: 'node-a', label: 'See' },
      { targetId: 'node-b', label: 'See [[node-a.md]] and' }
    ])
  })

  it('should return empty array when no wikilinks found', () => {
    const content: "Just plain text with no links" = 'Just plain text with no links'
    const nodes: { readonly '1': GraphNode; } = {
      '1': createNode('1')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([])
  })

  it('should preserve unresolved wikilinks for future node creation', () => {
    const content: "See [[1]] and [[non-existent]]" = 'See [[1]] and [[non-existent]]'
    const nodes: { readonly '1': GraphNode; } = {
      '1': createNode('1')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: '1', label: 'See' },
      { targetId: 'non-existent', label: 'See [[1]] and' }
    ])
  })

  it('should remove duplicate links', () => {
    const content: "See [[1]] and [[2]] and [[1]] again" = 'See [[1]] and [[2]] and [[1]] again'
    const nodes: { readonly '1': GraphNode; readonly '2': GraphNode; } = {
      '1': createNode('1'),
      '2': createNode('2')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: '1', label: 'See' },
      { targetId: '2', label: 'See [[1]] and' }
    ])
  })

  it('should preserve link order with duplicates removed', () => {
    const content: "[[3]] then [[1]] then [[2]] then [[1]]" = '[[3]] then [[1]] then [[2]] then [[1]]'
    const nodes: { readonly '1': GraphNode; readonly '2': GraphNode; readonly '3': GraphNode; } = {
      '1': createNode('1'),
      '2': createNode('2'),
      '3': createNode('3')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: '3', label: '' },
      { targetId: '1', label: '[[3]] then' },
      { targetId: '2', label: '[[3]] then [[1]] then' }
    ])
  })

  it('should handle multiple links in same line', () => {
    const content: "Multiple links: [[1]] [[2]] [[3]]" = 'Multiple links: [[1]] [[2]] [[3]]'
    const nodes: { readonly '1': GraphNode; readonly '2': GraphNode; readonly '3': GraphNode; } = {
      '1': createNode('1'),
      '2': createNode('2'),
      '3': createNode('3')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: '1', label: 'Multiple links:' },
      { targetId: '2', label: 'Multiple links: [[1]]' },
      { targetId: '3', label: 'Multiple links: [[1]] [[2]]' }
    ])
  })

  it('should handle links across multiple lines', () => {
    const content: "Line 1 with [[1]]\nLine 2 with [[2]]\nLine 3 with [[3]]" = `Line 1 with [[1]]
Line 2 with [[2]]
Line 3 with [[3]]`
    const nodes: { readonly '1': GraphNode; readonly '2': GraphNode; readonly '3': GraphNode; } = {
      '1': createNode('1'),
      '2': createNode('2'),
      '3': createNode('3')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: '1', label: 'Line 1 with' },
      { targetId: '2', label: 'Line 2 with' },
      { targetId: '3', label: 'Line 3 with' }
    ])
  })

  it('should trim whitespace in link text', () => {
    const content: "See [[  1  ]] with extra spaces" = 'See [[  1  ]] with extra spaces'
    const nodes: { readonly '1': GraphNode; } = {
      '1': createNode('1')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([{ targetId: '1', label: 'See' }])
  })

  it('should preserve links even when nodes record is empty', () => {
    const content: "See [[GraphNode A]]" = 'See [[GraphNode A]]'
    const nodes: Record<string, never> = {}

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([{ targetId: 'GraphNode A', label: 'See' }])
  })

  it('should handle content with no links and empty nodes', () => {
    const content: "Just plain text" = 'Just plain text'
    const nodes: Readonly<Record<string, never>> = {}

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([])
  })

  describe('path matching edge cases', () => {
    it('should match absolute paths to node IDs, preferring longer matches', () => {
      const content: "See [[/Users/bobbobby/repos/vaults/vscode_spike/_179.md]]" = 'See [[/Users/bobbobby/repos/vaults/vscode_spike/_179.md]]'
      const nodes: { readonly _179: GraphNode; readonly 'vscode_spike/_179': GraphNode; } = {
        '_179': createNode('_179'),
        'vscode_spike/_179': createNode('vscode_spike/_179')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      // Prefers longer match (vscode_spike/_179) over shorter (_179) for better specificity
      expect(result).toEqual([{ targetId: 'vscode_spike/_179', label: 'See' }])
    })

    it('should match absolute paths with partial path overlap', () => {
      const content: "Link to [[/Users/bobbobby/repos/vaults/vscode_spike/_179.md]]" = 'Link to [[/Users/bobbobby/repos/vaults/vscode_spike/_179.md]]'
      const nodes: { readonly 'vscode_spike/_179': GraphNode; } = {
        'vscode_spike/_179': createNode('vscode_spike/_179')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      expect(result).toEqual([{ targetId: 'vscode_spike/_179', label: 'Link to' }])
    })

    it('should handle relative paths from different bases', () => {
      const content: "See [[../other_folder/node.md]] and [[./subfolder/node2.md]]" = 'See [[../other_folder/node.md]] and [[./subfolder/node2.md]]'
      const nodes: { readonly 'other_folder/node': GraphNode; readonly 'subfolder/node2': GraphNode; } = {
        'other_folder/node': createNode('other_folder/node'),
        'subfolder/node2': createNode('subfolder/node2')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      expect(result).toEqual([
        { targetId: 'other_folder/node', label: 'See' },
        { targetId: 'subfolder/node2', label: 'See [[../other_folder/node.md]] and' }
      ])
    })

    it('should match paths with different levels of specificity, preferring longest match', () => {
      const content: "Link to [[/full/path/to/vault/folder/file.md]]" = 'Link to [[/full/path/to/vault/folder/file.md]]'
      const nodes: { readonly file: GraphNode; readonly 'folder/file': GraphNode; readonly 'vault/folder/file': GraphNode; } = {
        'file': createNode('file'),
        'folder/file': createNode('folder/file'),
        'vault/folder/file': createNode('vault/folder/file')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      // Prefers 'vault/folder/file' over 'folder/file' over 'file'
      expect(result).toEqual([{ targetId: 'vault/folder/file', label: 'Link to' }])
    })

    it('should handle absolute paths without extensions, preferring longer match', () => {
      const content: "See [[/Users/bobbobby/repos/vaults/project/_179]]" = 'See [[/Users/bobbobby/repos/vaults/project/_179]]'
      const nodes: { readonly _179: GraphNode; readonly 'project/_179': GraphNode; } = {
        '_179': createNode('_179'),
        'project/_179': createNode('project/_179')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      // Prefers longer match with more path context
      expect(result).toEqual([{ targetId: 'project/_179', label: 'See' }])
    })

    it('should match relative paths that resolve to same file', () => {
      const content: "Multiple refs: [[../../vault/note.md]] [[../vault/note.md]] [[vault/note.md]]" = 'Multiple refs: [[../../vault/note.md]] [[../vault/note.md]] [[vault/note.md]]'
      const nodes: { readonly 'vault/note': GraphNode; } = {
        'vault/note': createNode('vault/note')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      // All three relative paths should resolve to the same node - first occurrence wins
      expect(result).toEqual([{ targetId: 'vault/note', label: 'Multiple refs:' }])
    })

    it('should handle paths with special characters', () => {
      const content: "Link to [[/path/to/node_with-special.chars.md]]" = 'Link to [[/path/to/node_with-special.chars.md]]'
      const nodes: { readonly 'node_with-special.chars': GraphNode; } = {
        'node_with-special.chars': createNode('node_with-special.chars')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      expect(result).toEqual([{ targetId: 'node_with-special.chars', label: 'Link to' }])
    })

    it('should prioritize longer path matches over shorter ones', () => {
      const content: "See [[/full/absolute/path/to/deeply/nested/file.md]]" = 'See [[/full/absolute/path/to/deeply/nested/file.md]]'
      const nodes: { readonly file: GraphNode; readonly 'nested/file': GraphNode; readonly 'deeply/nested/file': GraphNode; } = {
        'file': createNode('file'),
        'nested/file': createNode('nested/file'),
        'deeply/nested/file': createNode('deeply/nested/file')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      // Prefers 'deeply/nested/file' over 'nested/file' over 'file'
      // The longer match provides more specificity and reduces ambiguity
      expect(result).toEqual([{ targetId: 'deeply/nested/file', label: 'See' }])
    })

    it('should handle mixed absolute and relative paths in same content', () => {
      const content: "\n        Absolute: [[/Users/user/vault/folder/_179.md]]\n        Relative parent: [[../folder/_179.md]]\n        Relative current: [[./folder/_179.md]]\n        Just filename: [[_179.md]]\n      " = `
        Absolute: [[/Users/user/vault/folder/_179.md]]
        Relative parent: [[../folder/_179.md]]
        Relative current: [[./folder/_179.md]]
        Just filename: [[_179.md]]
      `
      const nodes: { readonly 'folder/_179': GraphNode; } = {
        'folder/_179': createNode('folder/_179')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      // All paths should resolve to the same node (after proper path resolution)
      // First occurrence wins with its label
      expect(result).toEqual([{ targetId: 'folder/_179', label: 'Absolute:' }])
    })

    it('should handle ambiguous matches with same filename in different folders', () => {
      const content: "Link to [[README.md]]" = 'Link to [[README.md]]'
      const nodes: { readonly 'README.md': GraphNode; readonly 'docs/README.md': GraphNode; readonly 'src/README.md': GraphNode; } = {
        'README.md': createNode('README.md'),
        'docs/README.md': createNode('docs/README.md'),
        'src/README.md': createNode('src/README.md')
      }

      const result: readonly Edge[] = extractEdges(content, nodes)

      // When multiple nodes match the same filename with equal scores, prefer shorter paths
      // 'README.md' is shorter than 'docs/README.md' and 'src/README.md'
      expect(result).toEqual([{ targetId: 'README.md', label: 'Link to' }])
    })
  })

  it('should match subfolder path link to subfolder node', () => {
    // This is the exact case from the failing e2e test:
    // File: 2025-09-30/14_1_Victor_Append_Agent.md links to [[2025-09-30/14_Assign_Agent.md]]
    // Node: 2025-09-30/14_Assign_Agent.md
    const content: string = `- is_progress_of [[2025-09-30/14_Assign_Agent_to_Identify_Boundaries.md]]`

    const nodes: Record<string, GraphNode> = {
      '2025-09-30/14_Assign_Agent_to_Identify_Boundaries.md': createNode('2025-09-30/14_Assign_Agent_to_Identify_Boundaries.md')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    // Should match the full path
    expect(result).toEqual([
      { targetId: '2025-09-30/14_Assign_Agent_to_Identify_Boundaries.md', label: 'is_progress_of' }
    ])
  })

  it('should extract label from user markdown format with Parent: section', () => {
    const content: "---\nnode_id: 5\ntitle: Understand Google Cloud Lambda Creation (5)\n---\n### Understand the process of creating a Google Cloud Lambda function.\n\nA bit of background on how I can actually create the lambda itself.\n\n\n-----------------\n_Links:_\nParent:\n- is_a_prerequisite_for [[3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation.md]]" = `---
node_id: 5
title: Understand Google Cloud Lambda Creation (5)
---
### Understand the process of creating a Google Cloud Lambda function.

A bit of background on how I can actually create the lambda itself.


-----------------
_Links:_
Parent:
- is_a_prerequisite_for [[3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation.md]]`

    const nodes: { readonly '3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation': GraphNode; } = {
      '3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation': createNode('3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation')
    }

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: '3_Setup_G_Cloud_CLI_and_Understand_Lambda_Creation', label: 'is_a_prerequisite_for' }
    ])
  })
})
