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

    expect(result.relativeFilePathIsID).toBe('test')
    expect(result.content).toBe(content)
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

    expect(result.relativeFilePathIsID).toBe('test')
    expect(result.content).toBe(content)
    expect(O.isSome(result.nodeUIMetadata.position)).toBe(true)

    const position = O.getOrElse(() => ({ x: 0, y: 0 }))(result.nodeUIMetadata.position)
    expect(position.x).toBe(100)
    expect(position.y).toBe(200)
  })

  it('should use filename for node_id', () => {
    const content = `# Content`

    const result = parseMarkdownToGraphNode(content, 'my-file.md')

    expect(result.relativeFilePathIsID).toBe('my-file')
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

  it('should preserve full content including frontmatter', () => {
    const content = `---
color: "#123456"
---
# Test

Content here`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(result.content).toBe(content)
  })

  it('should handle nested paths in filename', () => {
    const content = '# Test'

    const result = parseMarkdownToGraphNode(content, 'subfolder/nested/file.md')

    expect(result.relativeFilePathIsID).toBe('subfolder/nested/file')
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

    expect(result.relativeFilePathIsID).toBe('bad-yaml')
    expect(result.content).toBe(content)
    expect(result.outgoingEdges).toEqual([])
    // Should fall back to heading when YAML fails
    expect(result.nodeUIMetadata.title).toBe('Fallback Heading')
  })
})
