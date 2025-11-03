import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/Option'
import { parseMarkdownToGraphNode } from '../../../../src/functional_graph/pure/markdown_parsing/parse-markdown-to-node'

describe('parseMarkdownToGraphNode', () => {
  it('should parse node with complete frontmatter', () => {
    const content = `---
node_id: "123"
title: "My Node"
summary: "A test node"
color: "#FF0000"
---
# Content here
Some text`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(result).toEqual({
      id: '123',
      title: 'My Node',
      content,
      summary: 'A test node',
      color: O.some('#FF0000')
    })
  })

  it('should use filename as fallback for node_id', () => {
    const content = `---
title: "My Node"
---
# Content`

    const result = parseMarkdownToGraphNode(content, 'my-file.md')

    expect(result.id).toBe('my-file')
  })

  it('should extract title from heading when not in frontmatter', () => {
    const content = `# Heading Title

Content here`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(result.title).toBe('Heading Title')
  })

  it('should use Untitled when no title found', () => {
    const content = 'Just plain text with no heading'

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(result.title).toBe('Untitled')
  })

  it('should prefer frontmatter title over heading', () => {
    const content = `---
title: "Frontmatter Title"
---
# Heading Title

Content`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(result.title).toBe('Frontmatter Title')
  })

  it('should use empty string for missing summary', () => {
    const content = `# Test

Content`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(result.summary).toBe('')
  })

  it('should use Option.none for missing color', () => {
    const content = `# Test

Content`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(O.isNone(result.color)).toBe(true)
  })

  it('should preserve full content including frontmatter', () => {
    const content = `---
node_id: "123"
---
# Test

Content here`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(result.content).toBe(content)
  })

  it('should handle nested paths in filename', () => {
    const content = '# Test'

    const result = parseMarkdownToGraphNode(content, 'subfolder/nested/file.md')

    expect(result.id).toBe('subfolder/nested/file')
  })

  it('should handle different heading levels', () => {
    const content = `## Second Level Heading

Content`

    const result = parseMarkdownToGraphNode(content, 'test.md')

    expect(result.title).toBe('Second Level Heading')
  })
})
