import { describe, it, expect } from 'vitest'
import { extractFrontmatter } from '@/pure/graph/markdown-parsing/extract-frontmatter.ts'

describe('extractFrontmatter', () => {
  it('should extract all frontmatter fields', () => {
    const content = `---
node_id: "123"
title: "My Node"
summary: "A test node"
color: "#FF0000"
---
# Content here`

    const result = extractFrontmatter(content)

    expect(result).toEqual({
      node_id: '123',
      title: 'My Node',
      summary: 'A test node',
      color: '#FF0000',
      position: undefined
    })
  })

  it('should handle single-quoted title with special characters', () => {
    const content = `---
node_id: 3
title: 'Bug: Auto-open Markdown Editor (3)'
---
### The manual editor's auto-open Markdown editor functionality is not working`

    const result = extractFrontmatter(content)

    expect(result.title).toBe('Bug: Auto-open Markdown Editor (3)')
    expect(result.node_id).toBe('3')
  })

  it('should handle missing frontmatter', () => {
    const content = '# Just a heading\n\nNo frontmatter here'

    const result = extractFrontmatter(content)

    expect(result).toEqual({
      node_id: undefined,
      title: undefined,
      summary: undefined,
      color: undefined,
      position: undefined
    })
  })

  it('should handle partial frontmatter', () => {
    const content = `---
node_id: "456"
title: "Partial Node"
---
# Content`

    const result = extractFrontmatter(content)

    expect(result).toEqual({
      node_id: '456',
      title: 'Partial Node',
      summary: undefined,
      color: undefined,
      position: undefined
    })
  })

  it('should handle empty frontmatter', () => {
    const content = `---
---
# Content`

    const result = extractFrontmatter(content)

    expect(result).toEqual({
      node_id: undefined,
      title: undefined,
      summary: undefined,
      color: undefined,
      position: undefined
    })
  })

  it('should handle frontmatter with extra fields', () => {
    const content = `---
node_id: "789"
title: "Extra Fields"
custom_field: "ignored"
another: 123
---
# Content`

    const result = extractFrontmatter(content)

    expect(result).toEqual({
      node_id: '789',
      title: 'Extra Fields',
      summary: undefined,
      color: undefined,
      position: undefined
    })
  })

  it('should throw on malformed YAML frontmatter with unquoted colons', () => {
    const content = `---
node_id: "123"
title: Invalid YAML: missing quotes cause problems
summary: This is not properly quoted
---
# Content`

    // Malformed YAML should throw an exception
    expect(() => extractFrontmatter(content)).toThrow(/incomplete explicit mapping pair/)
  })

  it('should parse frontmatter with parentheses without colons', () => {
    const content = `---
node_id: "456"
title: (Sam) Some Title Without Colons (v2)
summary: Valid YAML with parens
---
# Content`

    // Parentheses are fine as long as there's no unquoted colon
    const result = extractFrontmatter(content)
    expect(result).toEqual({
      node_id: '456',
      title: '(Sam) Some Title Without Colons (v2)',
      summary: 'Valid YAML with parens',
      color: undefined,
      position: undefined
    })
  })

  it('should normalize numeric node_id to string', () => {
    const content = `---
node_id: 123
title: "Numeric ID"
---
# Content`

    const result = extractFrontmatter(content)

    expect(result).toEqual({
      node_id: '123',
      title: 'Numeric ID',
      summary: undefined,
      color: undefined,
      position: undefined
    })
  })

  it('should parse position with x and y coordinates', () => {
    const content = `---
node_id: "123"
title: "Positioned Node"
color: "#FF0000"
position:
  x: 100
  y: 200
---
# Content`

    const result = extractFrontmatter(content)

    expect(result).toEqual({
      node_id: '123',
      title: 'Positioned Node',
      summary: undefined,
      color: '#FF0000',
      position: { x: 100, y: 200 }
    })
  })

  it('should handle missing position field', () => {
    const content = `---
node_id: "123"
title: "No Position"
---
# Content`

    const result = extractFrontmatter(content)

    expect(result).toEqual({
      node_id: '123',
      title: 'No Position',
      summary: undefined,
      color: undefined,
      position: undefined
    })
  })

  it('should handle invalid position data', () => {
    const content = `---
node_id: "123"
position: "invalid"
---
# Content`

    const result = extractFrontmatter(content)

    expect(result.position).toBeUndefined()
  })

  it('should handle partial position data', () => {
    const content = `---
node_id: "123"
position:
  x: 100
---
# Content`

    const result = extractFrontmatter(content)

    expect(result.position).toBeUndefined()
  })
})
