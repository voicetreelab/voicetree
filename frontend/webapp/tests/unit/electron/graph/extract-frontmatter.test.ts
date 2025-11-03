import { describe, it, expect } from 'vitest'
import { extractFrontmatter } from '../../../../src/functional_graph/pure/markdown_parsing/extract-frontmatter'

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
      color: '#FF0000'
    })
  })

  it('should handle missing frontmatter', () => {
    const content = '# Just a heading\n\nNo frontmatter here'

    const result = extractFrontmatter(content)

    expect(result).toEqual({
      node_id: undefined,
      title: undefined,
      summary: undefined,
      color: undefined
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
      color: undefined
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
      color: undefined
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
      color: undefined
    })
  })

  it('should fail fast on malformed YAML frontmatter', () => {
    const content = `---
node_id: "123"
title: Invalid YAML: missing quotes cause problems
summary: This is not properly quoted
---
# Content`

    // Should throw on malformed YAML - fail fast, no error handling
    expect(() => extractFrontmatter(content)).toThrow()
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
      color: undefined
    })
  })
})
