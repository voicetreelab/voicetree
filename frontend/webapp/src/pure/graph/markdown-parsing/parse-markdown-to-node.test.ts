import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { parseMarkdownToGraphNode } from '@/pure/graph/markdown-parsing/parse-markdown-to-node.ts'

describe('parseMarkdownToGraphNode', () => {
  it('should parse node with complete frontmatter including color', () => {
    const content = `---
color: "#FF0000"
---
# Content here
Some text`

    const result = parseMarkdownToGraphNode(content, 'test.md')

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

    const result = parseMarkdownToGraphNode(content, 'test.md')

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

    const result = parseMarkdownToGraphNode(content, 'my-file.md')

    expect(result.relativeFilePathIsID).toBe('my-file.md')
  })

  it('should use Option.none for missing color', () => {
    const content = `# Test

Content`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(O.isNone(result.nodeUIMetadata.color)).toBe(true)
  })

  it('should use Option.none for missing position', () => {
    const content = `# Test

Content`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(O.isNone(result.nodeUIMetadata.position)).toBe(true)
  })

  it('should strip frontmatter from content', () => {
    const content = `---
color: "#123456"
---
# Test

Content here`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    // contentWithoutYamlOrLinks should have YAML stripped
    expect(result.contentWithoutYamlOrLinks).toBe('# Test\n\nContent here')
  })

  it('should handle nested paths in filename', () => {
    const content = '# Test'

    const result = parseMarkdownToGraphNode(content, 'subfolder/nested/file.md')

    expect(result.relativeFilePathIsID).toBe('subfolder/nested/file.md')
  })

  it('should have empty outgoingEdges array', () => {
    const content = `# Test`

    const result = parseMarkdownToGraphNode(content, 'test.md')

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
    const result = parseMarkdownToGraphNode(content, 'bad-yaml.md')

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

    const result = parseMarkdownToGraphNode(content, 'test.md')

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

    const result = parseMarkdownToGraphNode(content, 'test.md')

    // Both YAML and wikilinks should be processed
    expect(result.contentWithoutYamlOrLinks).toBe('# Test\n\nContent with [link-one]* and [link-two]*')
    expect(O.isSome(result.nodeUIMetadata.color)).toBe(true)
    expect(result.outgoingEdges.length).toBe(2)
  })

  describe('Node ID should keep .md extension', () => {
    it('should keep .md extension in node ID for simple filename', () => {
      const content = '# Test Content'

      const result = parseMarkdownToGraphNode(content, 'test-file.md')

      expect(result.relativeFilePathIsID).toBe('test-file.md')
    })

    it('should keep .md extension in node ID for nested path', () => {
      const content = '# Nested Content'

      const result = parseMarkdownToGraphNode(content, 'folder/subfolder/note.md')

      expect(result.relativeFilePathIsID).toBe('folder/subfolder/note.md')
    })

    it('should keep .md extension when file has multiple dots', () => {
      const content = '# Multi-dot file'

      const result = parseMarkdownToGraphNode(content, 'file.backup.md')

      expect(result.relativeFilePathIsID).toBe('file.backup.md')
    })

    it('should handle file without .md extension as-is', () => {
      const content = '# No extension'

      const result = parseMarkdownToGraphNode(content, 'no-extension')

      expect(result.relativeFilePathIsID).toBe('no-extension')
    })
  })
})
