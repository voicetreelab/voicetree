import { describe, it, expect } from 'vitest'
import { extractPathSegments } from '@/pure/graph/markdown-parsing/extract-edges'

describe('extractPathSegments', () => {
  it('should return empty array for empty path', () => {
    expect(extractPathSegments('')).toEqual([])
  })

  it('should extract segments from full path with extension', () => {
    const result: readonly string[] = extractPathSegments('/Users/user/vault/folder/file.md')

    // Should include segments with extension (longest to shortest)
    // Then segments without extension (longest to shortest)
    expect(result).toContain('Users/user/vault/folder/file.md')
    expect(result).toContain('user/vault/folder/file.md')
    expect(result).toContain('vault/folder/file.md')
    expect(result).toContain('folder/file.md')
    expect(result).toContain('file.md')

    // Without extension
    expect(result).toContain('Users/user/vault/folder/file')
    expect(result).toContain('user/vault/folder/file')
    expect(result).toContain('vault/folder/file')
    expect(result).toContain('folder/file')
    expect(result).toContain('file')
  })

  it('should have segments with extension before segments without extension for same depth', () => {
    const result: readonly string[] = extractPathSegments('folder/file.md')

    // With extension segments should come before without extension
    const withExtIdx: number = result.indexOf('file.md')
    const withoutExtIdx: number = result.indexOf('file')

    expect(withExtIdx).toBeLessThan(withoutExtIdx)
  })

  it('should handle simple filename', () => {
    const result: readonly string[] = extractPathSegments('file.md')

    expect(result).toContain('file.md')
    expect(result).toContain('file')
  })

  it('should handle path without extension', () => {
    const result: readonly string[] = extractPathSegments('folder/file')

    expect(result).toContain('folder/file')
    expect(result).toContain('file')
  })

  it('should handle subfolder paths like felix/1', () => {
    const result: readonly string[] = extractPathSegments('felix/1')

    expect(result).toContain('felix/1')
    expect(result).toContain('1')
  })

  it('should handle filename with .md extension matching node without extension', () => {
    // When link is "1.md" and node is "felix/1"
    // extractPathSegments("1.md") should produce "1" which can match
    const result: readonly string[] = extractPathSegments('1.md')

    expect(result).toContain('1.md')
    expect(result).toContain('1')
  })
})
