import { describe, it, expect } from 'vitest'
import { getPathComponents, linkMatchScore } from '@/pure/graph/markdown-parsing/extract-edges'

describe('getPathComponents', () => {
  it('should return empty array for empty path', () => {
    expect(getPathComponents('')).toEqual([])
  })

  it('should extract components from path with .md extension', () => {
    const result: readonly string[] = getPathComponents('ctx-nodes/VT/foo.md')
    expect(result).toEqual(['ctx-nodes', 'VT', 'foo'])
  })

  it('should strip ./ prefix', () => {
    const result: readonly string[] = getPathComponents('./foo.md')
    expect(result).toEqual(['foo'])
  })

  it('should strip ../ prefix and keep remaining path', () => {
    const result: readonly string[] = getPathComponents('../bar/foo.md')
    expect(result).toEqual(['bar', 'foo'])
  })

  it('should handle path without extension', () => {
    const result: readonly string[] = getPathComponents('folder/file')
    expect(result).toEqual(['folder', 'file'])
  })

  it('should handle simple filename with .md', () => {
    const result: readonly string[] = getPathComponents('file.md')
    expect(result).toEqual(['file'])
  })

  it('should handle simple filename without extension', () => {
    const result: readonly string[] = getPathComponents('file')
    expect(result).toEqual(['file'])
  })

  it('should preserve .md in middle of filename (context node pattern)', () => {
    const result: readonly string[] = getPathComponents('Propose_Merge.md_context_123.md')
    expect(result).toEqual(['Propose_Merge.md_context_123'])
  })

  it('should handle multiple ../ prefixes', () => {
    const result: readonly string[] = getPathComponents('../../foo/bar.md')
    expect(result).toEqual(['foo', 'bar'])
  })
})

describe('linkMatchScore', () => {
  it('should return 0 for non-matching baseNames', () => {
    expect(linkMatchScore('./bar.md', 'a/b/foo.md')).toBe(0)
  })

  it('should return 1 for baseName-only match', () => {
    expect(linkMatchScore('./foo.md', 'a/b/foo.md')).toBe(1)
  })

  it('should return 2 for baseName + one parent match', () => {
    expect(linkMatchScore('b/foo.md', 'a/b/foo.md')).toBe(2)
  })

  it('should return 3 for full path match', () => {
    expect(linkMatchScore('a/b/foo.md', 'a/b/foo.md')).toBe(3)
  })

  it('should match link without extension to node with .md', () => {
    expect(linkMatchScore('foo', 'a/b/foo.md')).toBe(1)
  })

  it('should match link with .md to node with .md', () => {
    expect(linkMatchScore('foo.md', 'a/b/foo.md')).toBe(1)
  })

  it('should handle relative path prefix ./', () => {
    expect(linkMatchScore('./foo.md', 'ctx-nodes/VT/foo.md')).toBe(1)
  })

  it('should handle relative path prefix ../', () => {
    expect(linkMatchScore('../foo.md', 'ctx-nodes/foo.md')).toBe(1)
  })

  it('should handle context node pattern with .md in middle of filename', () => {
    // This is the actual bug case we fixed
    const link: string = './Propose_Merge.md_context_123.md'
    const node: string = 'ctx-nodes/VT/Propose_Merge.md_context_123.md'
    expect(linkMatchScore(link, node)).toBe(1)
  })

  it('should prefer longer path matches', () => {
    const link: string = 'VT/foo.md'
    const nodeShort: string = 'other/foo.md'
    const nodeLong: string = 'ctx-nodes/VT/foo.md'

    expect(linkMatchScore(link, nodeShort)).toBe(1) // only foo matches
    expect(linkMatchScore(link, nodeLong)).toBe(2)  // VT/foo matches
  })

  it('should return 0 for empty paths', () => {
    expect(linkMatchScore('', 'a/b/foo.md')).toBe(0)
    expect(linkMatchScore('foo.md', '')).toBe(0)
  })

  it('should not match different extensions', () => {
    // foo.txt should not match foo.md because we only strip .md
    expect(linkMatchScore('foo.txt', 'a/b/foo.md')).toBe(0)
  })
})
