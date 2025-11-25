import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { extractEdges } from '@/pure/graph/markdown-parsing/extract-edges.ts'
import type { GraphNode } from '@/pure/graph'

describe('extractEdges - subfolder bug reproduction', () => {
  const createNode = (id: string, content = '', title = id): GraphNode => ({
    relativeFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    outgoingEdges: [],
    nodeUIMetadata: {
      title,
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

    const nodes = {
      'felix/1': createNode('felix/1', '# Node 1 in felix', 'Node 1'),
      'felix/2': createNode('felix/2', 'Parent:\n- is_related_to [[1.md]]', 'Node 2')
    }

    const content = nodes['felix/2'].contentWithoutYamlOrLinks

    const result = extractEdges(content, nodes)

    // EXPECTED: Should find the edge from felix/2 -> felix/1
    // ACTUAL: Returns empty array because matching fails
    expect(result).toEqual([
      { targetId: 'felix/1', label: 'is_related_to' }
    ])
  })

  it('should extract edges when linking with filename only in subfolder', () => {
    // Variation: link is just [[1_Positive_Observation_on_System_Performance_Result.md]]
    // Both source and target are in felix/ subfolder

    const nodes = {
      'felix/1_Positive_Observation_on_System_Performance_Result': createNode(
        'felix/1_Positive_Observation_on_System_Performance_Result',
        '# Positive Observation',
        'Positive Observation'
      ),
      'felix/2_Unexplained_Bug_Encountered': createNode(
        'felix/2_Unexplained_Bug_Encountered',
        'Parent:\n- is_a_past_issue_related_to [[1_Positive_Observation_on_System_Performance_Result.md]]',
        'Unexplained Bug'
      )
    }

    const content = nodes['felix/2_Unexplained_Bug_Encountered'].contentWithoutYamlOrLinks

    const result = extractEdges(content, nodes)

    // EXPECTED: Should find felix/1_Positive_Observation_on_System_Performance_Result
    expect(result).toEqual([
      { targetId: 'felix/1_Positive_Observation_on_System_Performance_Result', label: 'is_a_past_issue_related_to' }
    ])
  })

  it('should work when using full path in wikilink', () => {
    // Control test: This SHOULD work with full path
    const nodes = {
      'felix/1': createNode('felix/1', '# Node 1', 'Node 1'),
      'felix/2': createNode('felix/2', '- related [[felix/1.md]]', 'Node 2')
    }

    const content = nodes['felix/2'].contentWithoutYamlOrLinks

    const result = extractEdges(content, nodes)

    expect(result).toEqual([
      { targetId: 'felix/1', label: 'related' }
    ])
  })
})
