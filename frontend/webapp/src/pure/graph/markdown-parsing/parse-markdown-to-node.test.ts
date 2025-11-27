import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { parseMarkdownToGraphNode } from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
import type { Graph, GraphNode } from '@/pure/graph'

// Helper to create an empty graph for testing
const emptyGraph: Graph = { nodes: {} }

describe('parseMarkdownToGraphNode', () => {
  it('should parse node with complete frontmatter including color', () => {
    const content: "---\ncolor: \"#FF0000\"\n---\n# Content here\nSome text" = `---
color: "#FF0000"
---
# Content here
Some text`

    const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('test.md')
    // contentWithoutYamlOrLinks should have YAML stripped
    expect(result.contentWithoutYamlOrLinks).toBe('# Content here\nSome text')
    expect(result.outgoingEdges).toEqual([])
    expect(O.isSome(result.nodeUIMetadata.color)).toBe(true)
    expect(O.getOrElse(() => '')(result.nodeUIMetadata.color)).toBe('#FF0000')
  })

  it('should parse node with position in frontmatter', () => {
    const content: "---\ncolor: \"#FF0000\"\nposition:\n  x: 100\n  y: 200\n---\n# Content here" = `---
color: "#FF0000"
position:
  x: 100
  y: 200
---
# Content here`

    const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('test.md')
    // contentWithoutYamlOrLinks should have YAML stripped
    expect(result.contentWithoutYamlOrLinks).toBe('# Content here')
    expect(O.isSome(result.nodeUIMetadata.position)).toBe(true)

    const position: { readonly x: number; readonly y: number; } = O.getOrElse(() => ({ x: 0, y: 0 }))(result.nodeUIMetadata.position)
    expect(position.x).toBe(100)
    expect(position.y).toBe(200)
  })

  it('should use filename for node_id', () => {
    const content: "# Content" = `# Content`

    const result: GraphNode = parseMarkdownToGraphNode(content, 'my-file.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('my-file.md')
  })

  it('should use Option.none for missing color', () => {
    const content: "# Test\n\nContent" = `# Test

Content`

    const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(O.isNone(result.nodeUIMetadata.color)).toBe(true)
  })

  it('should use Option.none for missing position', () => {
    const content: "# Test\n\nContent" = `# Test

Content`

    const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(O.isNone(result.nodeUIMetadata.position)).toBe(true)
  })

  it('should strip frontmatter from content', () => {
    const content: "---\ncolor: \"#123456\"\n---\n# Test\n\nContent here" = `---
color: "#123456"
---
# Test

Content here`

    const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    // contentWithoutYamlOrLinks should have YAML stripped
    expect(result.contentWithoutYamlOrLinks).toBe('# Test\n\nContent here')
  })

  it('should handle nested paths in filename', () => {
    const content: "# Test" = '# Test'

    const result: GraphNode = parseMarkdownToGraphNode(content, 'subfolder/nested/file.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('subfolder/nested/file.md')
  })

  it('should have empty outgoingEdges array', () => {
    const content: "# Test" = `# Test`

    const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(result.outgoingEdges).toEqual([])
  })

  it('should gracefully handle invalid YAML frontmatter and fall back to heading', () => {
    // This is the problematic YAML from the user's error: incomplete explicit mapping pair
    const content: "---\ntitle: (Ruby) Implementation Complete: Command-Hover Editor (16)\nbad_key: unquoted value with : colon causes problems\n---\n# Fallback Heading\n\nContent here" = `---
title: (Ruby) Implementation Complete: Command-Hover Editor (16)
bad_key: unquoted value with : colon causes problems
---
# Fallback Heading

Content here`

    // Should not throw, should return a valid node
    const result: GraphNode = parseMarkdownToGraphNode(content, 'bad-yaml.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('bad-yaml.md')
    // NOTE: gray-matter doesn't always strip invalid YAML, it tries to parse it anyway
    // The important thing is that it doesn't throw and the app keeps working
    expect(result.outgoingEdges).toEqual([])
    // Should fall back to heading when YAML parsing fails
    expect(result.nodeUIMetadata.title).toBe('Fallback Heading')
    // Content should have YAML stripped (gray-matter tries its best)
    expect(result.contentWithoutYamlOrLinks).toContain('# Fallback Heading')
  })

  it('should replace wikilinks with [link]* notation', () => {
    const content: "# Test Content\n\nThis references [[other-note]] and [[another-note]]." = `# Test Content

This references [[other-note]] and [[another-note]].`

    const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('test.md')
    // Wikilinks should be replaced with [link]* notation
    expect(result.contentWithoutYamlOrLinks).toBe('# Test Content\n\nThis references [other-note]* and [another-note]*.')
    // Edges should still be extracted
    expect(result.outgoingEdges.length).toBe(2)
    expect(result.outgoingEdges[0].targetId).toBe('other-note')
    expect(result.outgoingEdges[1].targetId).toBe('another-note')
  })

  it('should handle both YAML stripping and wikilink replacement', () => {
    const content: "---\ncolor: \"#FF0000\"\n---\n# Test\n\nContent with [[link-one]] and [[link-two]]" = `---
color: "#FF0000"
---
# Test

Content with [[link-one]] and [[link-two]]`

    const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    // Both YAML and wikilinks should be processed
    expect(result.contentWithoutYamlOrLinks).toBe('# Test\n\nContent with [link-one]* and [link-two]*')
    expect(O.isSome(result.nodeUIMetadata.color)).toBe(true)
    expect(result.outgoingEdges.length).toBe(2)
  })

  describe('Node ID should keep .md extension', () => {
    it('should keep .md extension in node ID for simple filename', () => {
      const content: "# Test Content" = '# Test Content'

      const result: GraphNode = parseMarkdownToGraphNode(content, 'test-file.md', emptyGraph)

      expect(result.relativeFilePathIsID).toBe('test-file.md')
    })

    it('should keep .md extension in node ID for nested path', () => {
      const content: "# Nested Content" = '# Nested Content'

      const result: GraphNode = parseMarkdownToGraphNode(content, 'folder/subfolder/note.md', emptyGraph)

      expect(result.relativeFilePathIsID).toBe('folder/subfolder/note.md')
    })

    it('should keep .md extension when file has multiple dots', () => {
      const content: "# Multi-dot file" = '# Multi-dot file'

      const result: GraphNode = parseMarkdownToGraphNode(content, 'file.backup.md', emptyGraph)

      expect(result.relativeFilePathIsID).toBe('file.backup.md')
    })

    it('should handle file without .md extension as-is', () => {
      const content: "# No extension" = '# No extension'

      const result: GraphNode = parseMarkdownToGraphNode(content, 'no-extension', emptyGraph)

      expect(result.relativeFilePathIsID).toBe('no-extension')
    })
  })

  describe('additionalYAMLProps', () => {
    it('should capture string properties without explicit fields in additionalYAMLProps', () => {
      const content: "---\ncolor: \"#FF0000\"\nauthor: \"John Doe\"\ncustom_field: \"some value\"\n---\n# Test" = `---
color: "#FF0000"
author: "John Doe"
custom_field: "some value"
---
# Test`

      const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      // color has an explicit typed field, so NOT in additionalYAMLProps
      // author and custom_field don't have explicit fields, so they ARE in additionalYAMLProps
      expect(result.nodeUIMetadata.additionalYAMLProps.size).toBe(2)
      expect(result.nodeUIMetadata.additionalYAMLProps.get('author')).toBe('John Doe')
      expect(result.nodeUIMetadata.additionalYAMLProps.get('custom_field')).toBe('some value')
      expect(result.nodeUIMetadata.additionalYAMLProps.has('color')).toBe(false)
    })

    it('should convert number properties to strings', () => {
      const content: "---\npriority: 5\nversion: 2.1\n---\n# Test" = `---
priority: 5
version: 2.1
---
# Test`

      const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      expect(result.nodeUIMetadata.additionalYAMLProps.get('priority')).toBe('5')
      expect(result.nodeUIMetadata.additionalYAMLProps.get('version')).toBe('2.1')
    })

    it('should convert boolean properties to strings', () => {
      const content: "---\npublished: true\narchived: false\n---\n# Test" = `---
published: true
archived: false
---
# Test`

      const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      expect(result.nodeUIMetadata.additionalYAMLProps.get('published')).toBe('true')
      expect(result.nodeUIMetadata.additionalYAMLProps.get('archived')).toBe('false')
    })

    it('should convert array properties to JSON strings', () => {
      const content: "---\ntags:\n  - important\n  - draft\nnumbers:\n  - 1\n  - 2\n  - 3\n---\n# Test" = `---
tags:
  - important
  - draft
numbers:
  - 1
  - 2
  - 3
---
# Test`

      const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      expect(result.nodeUIMetadata.additionalYAMLProps.get('tags')).toBe('["important","draft"]')
      expect(result.nodeUIMetadata.additionalYAMLProps.get('numbers')).toBe('[1,2,3]')
    })

    it('should convert object properties to JSON strings', () => {
      const content: "---\nmetadata:\n  created: \"2024-01-15\"\n  version: 2\n---\n# Test" = `---
metadata:
  created: "2024-01-15"
  version: 2
---
# Test`

      const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      const metadata: string | undefined = result.nodeUIMetadata.additionalYAMLProps.get('metadata')
      expect(metadata).toBeDefined()
      const parsed: { readonly created: string; readonly version: number; } = JSON.parse(metadata!)
      expect(parsed.created).toBe('2024-01-15')
      expect(parsed.version).toBe(2)
    })

    it('should preserve YAML properties without explicit fields, exclude color/position/isContextNode/title', () => {
      const content: "---\ncolor: \"#FF0000\"\nposition:\n  x: 100\n  y: 200\ntitle: \"My Title\"\nsummary: \"My Summary\"\nnode_id: \"legacy-id\"\ncustom_prop: \"should be included\"\n---\n# Test" = `---
color: "#FF0000"
position:
  x: 100
  y: 200
title: "My Title"
summary: "My Summary"
node_id: "legacy-id"
custom_prop: "should be included"
---
# Test`

      const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      // color, position, isContextNode, title have explicit typed fields → NOT in additionalYAMLProps
      // summary, node_id, custom_prop don't → ARE in additionalYAMLProps
      expect(result.nodeUIMetadata.additionalYAMLProps.size).toBe(3)
      expect(result.nodeUIMetadata.additionalYAMLProps.get('custom_prop')).toBe('should be included')
      expect(result.nodeUIMetadata.additionalYAMLProps.get('summary')).toBe('My Summary')
      expect(result.nodeUIMetadata.additionalYAMLProps.get('node_id')).toBe('legacy-id')
      expect(result.nodeUIMetadata.additionalYAMLProps.has('color')).toBe(false)
      expect(result.nodeUIMetadata.additionalYAMLProps.has('position')).toBe(false)
      expect(result.nodeUIMetadata.additionalYAMLProps.has('title')).toBe(false)
    })

    it('should have empty additionalYAMLProps when only color/position exist (they have explicit fields)', () => {
      const content: "---\ncolor: \"#FF0000\"\nposition:\n  x: 100\n  y: 200\n---\n# Test" = `---
color: "#FF0000"
position:
  x: 100
  y: 200
---
# Test`

      const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      // color and position have explicit typed fields, so NOT in additionalYAMLProps
      expect(result.nodeUIMetadata.additionalYAMLProps.size).toBe(0)
      // But they ARE in the explicit fields
      expect(result.nodeUIMetadata.color._tag).toBe('Some')
      expect(result.nodeUIMetadata.position._tag).toBe('Some')
    })

    it('should have empty additionalYAMLProps when no frontmatter exists', () => {
      const content: "# Test\n\nContent without frontmatter" = `# Test

Content without frontmatter`

      const result: GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      expect(result.nodeUIMetadata.additionalYAMLProps.size).toBe(0)
    })
  })

  describe('containedNodeIds', () => {
    it('should parse containedNodeIds array from frontmatter', () => {
      const content: string = `---
isContextNode: true
containedNodeIds:
  - node1.md
  - folder/node2.md
  - deep/path/node3.md
---
# Context Node Content`

      const result: GraphNode = parseMarkdownToGraphNode(content, 'context.md', emptyGraph)

      expect(result.nodeUIMetadata.isContextNode).toBe(true)
      expect(result.nodeUIMetadata.containedNodeIds).toEqual([
        'node1.md',
        'folder/node2.md',
        'deep/path/node3.md'
      ])
    })

    it('should return undefined for containedNodeIds when not present', () => {
      const content: string = `---
title: Regular Node
---
# Content`

      const result: GraphNode = parseMarkdownToGraphNode(content, 'regular.md', emptyGraph)

      expect(result.nodeUIMetadata.containedNodeIds).toBeUndefined()
    })

    it('should return undefined for containedNodeIds when not an array', () => {
      const content: string = `---
containedNodeIds: "not-an-array"
---
# Content`

      const result: import('@/pure/graph').GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      expect(result.nodeUIMetadata.containedNodeIds).toBeUndefined()
    })

    it('should filter out non-string values from containedNodeIds', () => {
      const content: string = `---
containedNodeIds:
  - valid-node.md
  - 123
  - another-valid.md
---
# Content`

      const result: import('@/pure/graph').GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      // Only string values should be included
      expect(result.nodeUIMetadata.containedNodeIds).toEqual([
        'valid-node.md',
        'another-valid.md'
      ])
    })

    it('should return empty array when containedNodeIds is empty array', () => {
      const content: string = `---
containedNodeIds: []
---
# Content`

      const result: import('@/pure/graph').GraphNode = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      expect(result.nodeUIMetadata.containedNodeIds).toEqual([])
    })
  })
})
