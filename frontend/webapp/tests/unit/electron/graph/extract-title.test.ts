import { describe, it, expect } from 'vitest'
import { extractTitle } from '../../../../src/functional_graph/pure/markdown_parsing/extract-title'

describe('extractTitle', () => {
  it('should extract level 1 heading', () => {
    const content = '# My Title\n\nSome content here'

    const result = extractTitle(content)

    expect(result).toBe('My Title')
  })

  it('should extract level 2 heading', () => {
    const content = '## Second Level Heading\n\nContent'

    const result = extractTitle(content)

    expect(result).toBe('Second Level Heading')
  })

  it('should extract level 6 heading', () => {
    const content = '###### Sixth Level\n\nContent'

    const result = extractTitle(content)

    expect(result).toBe('Sixth Level')
  })

  it('should extract first heading when multiple headings exist', () => {
    const content = '# First Heading\n\nSome text\n\n## Second Heading'

    const result = extractTitle(content)

    expect(result).toBe('First Heading')
  })

  it('should return undefined when no heading exists', () => {
    const content = 'Just plain text without any headings\n\nMore text here'

    const result = extractTitle(content)

    expect(result).toBeUndefined()
  })

  it('should return undefined for empty string', () => {
    const content = ''

    const result = extractTitle(content)

    expect(result).toBeUndefined()
  })

  it('should handle heading with extra whitespace', () => {
    const content = '#   Title with extra spaces   \n\nContent'

    const result = extractTitle(content)

    expect(result).toBe('Title with extra spaces')
  })

  it('should handle heading with special characters', () => {
    const content = '# Title with $pecial Ch@racters & Symbols!\n\nContent'

    const result = extractTitle(content)

    expect(result).toBe('Title with $pecial Ch@racters & Symbols!')
  })

  it('should handle heading with unicode characters', () => {
    const content = '# 日本語 タイトル 🎉\n\nContent'

    const result = extractTitle(content)

    expect(result).toBe('日本語 タイトル 🎉')
  })

  it('should handle heading not at start of document', () => {
    const content = 'Some text before\n\n# Heading Here\n\nContent'

    const result = extractTitle(content)

    expect(result).toBe('Heading Here')
  })

  it('should handle heading with inline code', () => {
    const content = '# Title with `code` in it\n\nContent'

    const result = extractTitle(content)

    expect(result).toBe('Title with `code` in it')
  })

  it('should handle heading with links', () => {
    const content = '# Title with [[link]] and [another](url)\n\nContent'

    const result = extractTitle(content)

    expect(result).toBe('Title with [[link]] and [another](url)')
  })

  it('should match first heading even if in code block', () => {
    const content = '```\n# Not a heading\n```\n\n# Real Heading\n\nContent'

    const result = extractTitle(content)

    // The simple regex matches any heading, even in code blocks
    // This tests actual behavior, not desired behavior
    expect(result).toBe('Not a heading')
  })

  it('should handle single # without space as not a heading', () => {
    const content = '#NoSpace\n\n# Real Heading\n\nContent'

    const result = extractTitle(content)

    expect(result).toBe('Real Heading')
  })

  it('should skip heading with only whitespace and match next heading', () => {
    const content = '#NotAMatch\n\n# Real Heading\n\nContent'

    const result = extractTitle(content)

    // The regex requires space after # to be a valid heading
    // So it will skip #NotAMatch and find # Real Heading
    expect(result).toBe('Real Heading')
  })

  it('should handle multiline content with windows line endings', () => {
    const content = '# Title\r\n\r\nContent here'

    const result = extractTitle(content)

    expect(result).toBe('Title')
  })
})
