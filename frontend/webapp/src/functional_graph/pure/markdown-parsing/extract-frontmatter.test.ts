import { describe, it, expect } from 'vitest'
import { extractFrontmatter } from '@/functional_graph/pure/markdown-parsing/extract-frontmatter.ts'

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
      position: undefined,
      error_parsing: undefined
    })
  })

  it('should handle missing frontmatter', () => {
    const content = '# Just a heading\n\nNo frontmatter here'

    const result = extractFrontmatter(content)

    expect(result).toEqual({
      node_id: undefined,
      title: undefined,
      summary: undefined,
      color: undefined,
      position: undefined,
      error_parsing: undefined
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
      position: undefined,
      error_parsing: undefined
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
      position: undefined,
      error_parsing: undefined
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
      position: undefined,
      error_parsing: undefined
    })
  })

  it('should gracefully handle malformed YAML frontmatter', () => {
    const content = `---
node_id: "123"
title: Invalid YAML: missing quotes cause problems
summary: This is not properly quoted
---
# Content`

    // Should catch malformed YAML and return error_parsing field
    const result = extractFrontmatter(content)
    expect(result.error_parsing).toBeDefined()
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
      position: undefined,
      error_parsing: undefined
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
      position: { x: 100, y: 200 },
      error_parsing: undefined
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
      position: undefined,
      error_parsing: undefined
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
    expect(result.error_parsing).toBeUndefined()
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
    expect(result.error_parsing).toBeUndefined()
  })
})
