import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { extractEdges, findBestMatchingNode, getPathComponents } from '@/pure/graph/markdown-parsing/extract-edges'
import type { GraphNode, Edge } from '@/pure/graph'

describe('findBestMatchingNode - full path match requirement', () => {
  const createNode: (id: string, content?: string) => GraphNode = (id: string, content = ''): GraphNode => ({
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    outgoingEdges: [],
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  it('should not match when link has more specific path than any node', () => {
    // Link: openspec/changes/add-run-agent-on-selection/tasks.md (4 components)
    // Node: only simplify-vault-path-architecture/tasks.md exists (only "tasks" matches = score 1)
    // Expected: undefined (no match) because 1 < 4 components required
    const link: string = 'openspec/changes/add-run-agent-on-selection/tasks.md'
    const nodes: Record<string, GraphNode> = {
      '/path/to/simplify-vault-path-architecture/tasks.md': createNode('/path/to/simplify-vault-path-architecture/tasks.md')
    }
    expect(findBestMatchingNode(link, nodes)).toBeUndefined()
  })

  it('should match when all link components match from end', () => {
    // Link: b/c/tasks.md (3 components)
    // Node: a/b/c/tasks.md (all 3 match from end = score 3)
    // Expected: match because 3 >= 3 components
    const link: string = 'b/c/tasks.md'
    const nodes: Record<string, GraphNode> = {
      'a/b/c/tasks.md': createNode('a/b/c/tasks.md')
    }
    expect(findBestMatchingNode(link, nodes)).toBe('a/b/c/tasks.md')
  })

  it('should match simple basename links to any file with that name', () => {
    // Link: tasks.md (1 component)
    // Node: any/path/tasks.md
    // Expected: match because 1 >= 1 component
    const link: string = 'tasks.md'
    const nodes: Record<string, GraphNode> = {
      'any/path/tasks.md': createNode('any/path/tasks.md')
    }
    expect(findBestMatchingNode(link, nodes)).toBe('any/path/tasks.md')
  })

  it('should prefer better matches when multiple nodes exist', () => {
    // Link: a/b/tasks.md (3 components)
    // Node 1: x/y/tasks.md (only "tasks" matches = score 1)
    // Node 2: z/a/b/tasks.md (all 3 match = score 3)
    // Expected: Node 2 (higher score and meets threshold)
    const link: string = 'a/b/tasks.md'
    const nodes: Record<string, GraphNode> = {
      'x/y/tasks.md': createNode('x/y/tasks.md'),
      'z/a/b/tasks.md': createNode('z/a/b/tasks.md')
    }
    expect(findBestMatchingNode(link, nodes)).toBe('z/a/b/tasks.md')
  })

  it('should return undefined when partial path match is insufficient', () => {
    // Link: a/b/c/tasks.md (4 components)
    // Node: x/b/c/tasks.md (only b/c/tasks match = score 3)
    // Expected: undefined because 3 < 4 components
    const link: string = 'a/b/c/tasks.md'
    const nodes: Record<string, GraphNode> = {
      'x/b/c/tasks.md': createNode('x/b/c/tasks.md')
    }
    expect(findBestMatchingNode(link, nodes)).toBeUndefined()
  })
})

describe('getPathComponents', () => {
  it('should extract components correctly', () => {
    expect(getPathComponents('a/b/c/tasks.md')).toEqual(['a', 'b', 'c', 'tasks'])
    expect(getPathComponents('tasks.md')).toEqual(['tasks'])
    expect(getPathComponents('./tasks.md')).toEqual(['tasks'])
    expect(getPathComponents('../b/tasks.md')).toEqual(['b', 'tasks'])
  })
})

describe('extractEdges - empty wikilink handling', () => {
  const createNode: (id: string, content?: string) => GraphNode = (id: string, content = ''): GraphNode => ({
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    outgoingEdges: [],
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  it('should ignore empty wikilinks [[]]', () => {
    const nodes: Record<string, GraphNode> = {
      'a/file': createNode('a/file', 'content')
    }
    const content: string = 'Text with [[]] empty link'
    const result: readonly Edge[] = extractEdges(content, nodes)
    expect(result).toEqual([])
  })

  it('should ignore dot-only wikilinks [[.]]', () => {
    const nodes: Record<string, GraphNode> = {
      'a/file': createNode('a/file', 'content')
    }
    const content: string = 'Text with [[.]] dot link'
    const result: readonly Edge[] = extractEdges(content, nodes)
    expect(result).toEqual([])
  })

  it('should ignore whitespace-only wikilinks [[ ]]', () => {
    const nodes: Record<string, GraphNode> = {
      'a/file': createNode('a/file', 'content')
    }
    const content: string = 'Text with [[ ]] space link'
    const result: readonly Edge[] = extractEdges(content, nodes)
    expect(result).toEqual([])
  })

  it('should extract valid links while ignoring empty ones', () => {
    const nodes: Record<string, GraphNode> = {
      'a/target': createNode('a/target', 'content')
    }
    const content: string = 'Valid [[target.md]] and empty [[]] mixed'
    const result: readonly Edge[] = extractEdges(content, nodes)
    expect(result).toEqual([{ targetId: 'a/target', label: 'Valid' }])
  })

  it('should ignore multiple empty wikilinks in same content', () => {
    const nodes: Record<string, GraphNode> = {
      'a/file': createNode('a/file', 'content')
    }
    const content: string = 'First [[]] second [[.]] third [[ ]] end'
    const result: readonly Edge[] = extractEdges(content, nodes)
    expect(result).toEqual([])
  })
})

describe('extractEdges - subfolder bug reproduction', () => {
  const createNode: (id: string, content?: string) => GraphNode = (id: string, content = ''): GraphNode => ({
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    outgoingEdges: [],
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
      isContextNode: false
    }
  })

  it('should extract edges when linking to nodes in the same subfolder (BUG REPRODUCTION)', () => {
    // Setup: Two nodes in a subfolder
    // Node "felix/2.md" links to "felix/1.md"
    // Link text in content is just "[[1.md]]" (without the subfolder prefix)

    const nodes: { readonly 'felix/1': GraphNode; readonly 'felix/2': GraphNode; } = {
      'felix/1': createNode('felix/1', '# Node 1 in felix'),
      'felix/2': createNode('felix/2', 'Parent:\n- is_related_to [[1.md]]')
    }

    const content: string = nodes['felix/2'].contentWithoutYamlOrLinks

    const result: readonly Edge[] = extractEdges(content, nodes)

    // EXPECTED: Should find the edge from felix/2 -> felix/1
    // ACTUAL: Returns empty array because matching fails
    expect(result).toEqual([
      { targetId: 'felix/1', label: 'is_related_to' }
    ])
  })

  it('should extract edges when linking with filename only in subfolder', () => {
    // Variation: link is just [[1_Positive_Observation_on_System_Performance_Result.md]]
    // Both source and target are in felix/ subfolder

    const nodes: { readonly 'felix/1_Positive_Observation_on_System_Performance_Result': GraphNode; readonly 'felix/2_Unexplained_Bug_Encountered': GraphNode; } = {
      'felix/1_Positive_Observation_on_System_Performance_Result': createNode(
        'felix/1_Positive_Observation_on_System_Performance_Result',
        '# Positive Observation'
      ),
      'felix/2_Unexplained_Bug_Encountered': createNode(
        'felix/2_Unexplained_Bug_Encountered',
        'Parent:\n- is_a_past_issue_related_to [[1_Positive_Observation_on_System_Performance_Result.md]]'
      )
    }

    const content: string = nodes['felix/2_Unexplained_Bug_Encountered'].contentWithoutYamlOrLinks

    const result: readonly Edge[] = extractEdges(content, nodes)

    // EXPECTED: Should find felix/1_Positive_Observation_on_System_Performance_Result
    expect(result).toEqual([
      { targetId: 'felix/1_Positive_Observation_on_System_Performance_Result', label: 'is_a_past_issue_related_to' }
    ])
  })

  it('should work when using full path in wikilink', () => {
    // Control test: This SHOULD work with full path
    const nodes: { readonly 'felix/1': GraphNode; readonly 'felix/2': GraphNode; } = {
      'felix/1': createNode('felix/1', '# Node 1'),
      'felix/2': createNode('felix/2', '- related [[felix/1.md]]')
    }

    const content: string = nodes['felix/2'].contentWithoutYamlOrLinks

    const result: readonly Edge[] = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: 'felix/1', label: 'related' }
    ])
  })
})
