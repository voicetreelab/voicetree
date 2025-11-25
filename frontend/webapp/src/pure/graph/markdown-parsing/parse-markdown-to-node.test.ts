import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { parseMarkdownToGraphNode } from '@/pure/graph/markdown-parsing/parse-markdown-to-node.ts'
import type { Graph } from '@/pure/graph'

// Helper to create an empty graph for testing
const emptyGraph: Graph = { nodes: {} }

describe('parseMarkdownToGraphNode', () => {
  it('should parse node with complete frontmatter including color', () => {
    const content = `---
color: "#FF0000"
---
# Content here
Some text`

    const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('test.md')
    // contentWithoutYamlOrLinks should have YAML stripped
    expect(result.contentWithoutYamlOrLinks).toBe('# Content here\nSome text')
    expect(result.outgoingEdges).toEqual([])
    expect(O.isSome(result.nodeUIMetadata.color)).toBe(true)
    expect(O.getOrElse(() => '')(result.nodeUIMetadata.color)).toBe('#FF0000')
  })

  it('should parse node with position in frontmatter', () => {
    const content = `---
color: "#FF0000"
position:
  x: 100
  y: 200
---
# Content here`

    const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('test.md')
    // contentWithoutYamlOrLinks should have YAML stripped
    expect(result.contentWithoutYamlOrLinks).toBe('# Content here')
    expect(O.isSome(result.nodeUIMetadata.position)).toBe(true)

    const position = O.getOrElse(() => ({ x: 0, y: 0 }))(result.nodeUIMetadata.position)
    expect(position.x).toBe(100)
    expect(position.y).toBe(200)
  })

  it('should use filename for node_id', () => {
    const content = `# Content`

    const result = parseMarkdownToGraphNode(content, 'my-file.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('my-file.md')
  })

  it('should use Option.none for missing color', () => {
    const content = `# Test

Content`

    const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(O.isNone(result.nodeUIMetadata.color)).toBe(true)
  })

  it('should use Option.none for missing position', () => {
    const content = `# Test

Content`

    const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(O.isNone(result.nodeUIMetadata.position)).toBe(true)
  })

  it('should strip frontmatter from content', () => {
    const content = `---
color: "#123456"
---
# Test

Content here`

    const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    // contentWithoutYamlOrLinks should have YAML stripped
    expect(result.contentWithoutYamlOrLinks).toBe('# Test\n\nContent here')
  })

  it('should handle nested paths in filename', () => {
    const content = '# Test'

    const result = parseMarkdownToGraphNode(content, 'subfolder/nested/file.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('subfolder/nested/file.md')
  })

  it('should have empty outgoingEdges array', () => {
    const content = `# Test`

    const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(result.outgoingEdges).toEqual([])
  })

  it('should gracefully handle invalid YAML frontmatter and fall back to heading', () => {
    // This is the problematic YAML from the user's error: incomplete explicit mapping pair
    const content = `---
title: (Ruby) Implementation Complete: Command-Hover Editor (16)
bad_key: unquoted value with : colon causes problems
---
# Fallback Heading

Content here`

    // Should not throw, should return a valid node
    const result = parseMarkdownToGraphNode(content, 'bad-yaml.md', emptyGraph)

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
    const content = `# Test Content

This references [[other-note]] and [[another-note]].`

    const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    expect(result.relativeFilePathIsID).toBe('test.md')
    // Wikilinks should be replaced with [link]* notation
    expect(result.contentWithoutYamlOrLinks).toBe('# Test Content\n\nThis references [other-note]* and [another-note]*.')
    // Edges should still be extracted
    expect(result.outgoingEdges.length).toBe(2)
    expect(result.outgoingEdges[0].targetId).toBe('other-note')
    expect(result.outgoingEdges[1].targetId).toBe('another-note')
  })

  it('should handle both YAML stripping and wikilink replacement', () => {
    const content = `---
color: "#FF0000"
---
# Test

Content with [[link-one]] and [[link-two]]`

    const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

    // Both YAML and wikilinks should be processed
    expect(result.contentWithoutYamlOrLinks).toBe('# Test\n\nContent with [link-one]* and [link-two]*')
    expect(O.isSome(result.nodeUIMetadata.color)).toBe(true)
    expect(result.outgoingEdges.length).toBe(2)
  })

  describe('Node ID should keep .md extension', () => {
    it('should keep .md extension in node ID for simple filename', () => {
      const content = '# Test Content'

      const result = parseMarkdownToGraphNode(content, 'test-file.md', emptyGraph)

      expect(result.relativeFilePathIsID).toBe('test-file.md')
    })

    it('should keep .md extension in node ID for nested path', () => {
      const content = '# Nested Content'

      const result = parseMarkdownToGraphNode(content, 'folder/subfolder/note.md', emptyGraph)

      expect(result.relativeFilePathIsID).toBe('folder/subfolder/note.md')
    })

    it('should keep .md extension when file has multiple dots', () => {
      const content = '# Multi-dot file'

      const result = parseMarkdownToGraphNode(content, 'file.backup.md', emptyGraph)

      expect(result.relativeFilePathIsID).toBe('file.backup.md')
    })

    it('should handle file without .md extension as-is', () => {
      const content = '# No extension'

      const result = parseMarkdownToGraphNode(content, 'no-extension', emptyGraph)

      expect(result.relativeFilePathIsID).toBe('no-extension')
    })
  })

  describe('additionalYAMLProps', () => {
    it('should capture string properties without explicit fields in additionalYAMLProps', () => {
      const content = `---
color: "#FF0000"
author: "John Doe"
custom_field: "some value"
---
# Test`

      const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      // color has an explicit typed field, so NOT in additionalYAMLProps
      // author and custom_field don't have explicit fields, so they ARE in additionalYAMLProps
      expect(result.nodeUIMetadata.additionalYAMLProps.size).toBe(2)
      expect(result.nodeUIMetadata.additionalYAMLProps.get('author')).toBe('John Doe')
      expect(result.nodeUIMetadata.additionalYAMLProps.get('custom_field')).toBe('some value')
      expect(result.nodeUIMetadata.additionalYAMLProps.has('color')).toBe(false)
    })

    it('should convert number properties to strings', () => {
      const content = `---
priority: 5
version: 2.1
---
# Test`

      const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      expect(result.nodeUIMetadata.additionalYAMLProps.get('priority')).toBe('5')
      expect(result.nodeUIMetadata.additionalYAMLProps.get('version')).toBe('2.1')
    })

    it('should convert boolean properties to strings', () => {
      const content = `---
published: true
archived: false
---
# Test`

      const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      expect(result.nodeUIMetadata.additionalYAMLProps.get('published')).toBe('true')
      expect(result.nodeUIMetadata.additionalYAMLProps.get('archived')).toBe('false')
    })

    it('should convert array properties to JSON strings', () => {
      const content = `---
tags:
  - important
  - draft
numbers:
  - 1
  - 2
  - 3
---
# Test`

      const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      expect(result.nodeUIMetadata.additionalYAMLProps.get('tags')).toBe('["important","draft"]')
      expect(result.nodeUIMetadata.additionalYAMLProps.get('numbers')).toBe('[1,2,3]')
    })

    it('should convert object properties to JSON strings', () => {
      const content = `---
metadata:
  created: "2024-01-15"
  version: 2
---
# Test`

      const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      const metadata = result.nodeUIMetadata.additionalYAMLProps.get('metadata')
      expect(metadata).toBeDefined()
      const parsed = JSON.parse(metadata!)
      expect(parsed.created).toBe('2024-01-15')
      expect(parsed.version).toBe(2)
    })

    it('should preserve YAML properties without explicit fields, exclude color/position/isContextNode/title', () => {
      const content = `---
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

      const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

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
      const content = `---
color: "#FF0000"
position:
  x: 100
  y: 200
---
# Test`

      const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      // color and position have explicit typed fields, so NOT in additionalYAMLProps
      expect(result.nodeUIMetadata.additionalYAMLProps.size).toBe(0)
      // But they ARE in the explicit fields
      expect(result.nodeUIMetadata.color._tag).toBe('Some')
      expect(result.nodeUIMetadata.position._tag).toBe('Some')
    })

    it('should have empty additionalYAMLProps when no frontmatter exists', () => {
      const content = `# Test

Content without frontmatter`

      const result = parseMarkdownToGraphNode(content, 'test.md', emptyGraph)

      expect(result.nodeUIMetadata.additionalYAMLProps.size).toBe(0)
    })
  })
})
