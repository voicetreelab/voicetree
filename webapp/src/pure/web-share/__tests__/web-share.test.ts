import { describe, it, expect } from 'vitest'
import * as E from 'fp-ts/lib/Either.js'
import { validateUpload } from '@/pure/web-share/validateUpload'
import { buildManifest } from '@/pure/web-share/buildManifest'
import { buildGraphFromFiles } from '@/pure/web-share/buildGraphFromFiles'
import type { UploadError, RelativePath, ShareManifest } from '@/pure/web-share/types'
import { MAX_FILE_SIZE } from '@/pure/web-share/types'
import type { Graph, GraphNode, Edge } from '@/pure/graph'

// ============================================================================
// validateUpload
// ============================================================================

describe('validateUpload', () => {
  it('returns Right with .md paths for valid files', () => {
    const files: ReadonlyMap<string, string> = new Map([
      ['readme.md', '# Hello'],
      ['notes/todo.md', '# Todo']
    ])
    const result: E.Either<UploadError, readonly RelativePath[]> = validateUpload(files)
    expect(E.isRight(result)).toBe(true)
    if (E.isRight(result)) {
      expect(result.right).toEqual(['readme.md', 'notes/todo.md'])
    }
  })

  it('returns Left NoMarkdownFiles when no .md files', () => {
    const files: ReadonlyMap<string, string> = new Map([
      ['image.png', 'binary data'],
      ['config.json', '{}']
    ])
    const result: E.Either<UploadError, readonly RelativePath[]> = validateUpload(files)
    expect(E.isLeft(result)).toBe(true)
    if (E.isLeft(result)) {
      expect(result.left.tag).toBe('NoMarkdownFiles')
    }
  })

  it('normalizes backslashes to forward slashes', () => {
    const files: ReadonlyMap<string, string> = new Map([
      ['subfolder\\note.md', '# Note']
    ])
    const result: E.Either<UploadError, readonly RelativePath[]> = validateUpload(files)
    expect(E.isRight(result)).toBe(true)
    if (E.isRight(result)) {
      expect(result.right).toEqual(['subfolder/note.md'])
    }
  })

  it('strips leading ./ and /', () => {
    const files: ReadonlyMap<string, string> = new Map([
      ['./leading-dot.md', '# Dot'],
      ['/leading-slash.md', '# Slash']
    ])
    const result: E.Either<UploadError, readonly RelativePath[]> = validateUpload(files)
    expect(E.isRight(result)).toBe(true)
    if (E.isRight(result)) {
      expect(result.right).toEqual(['leading-dot.md', 'leading-slash.md'])
    }
  })

  it('rejects paths with .. (returns InvalidPath)', () => {
    const files: ReadonlyMap<string, string> = new Map([
      ['../escape.md', '# Escape']
    ])
    const result: E.Either<UploadError, readonly RelativePath[]> = validateUpload(files)
    expect(E.isLeft(result)).toBe(true)
    if (E.isLeft(result)) {
      const err: Extract<UploadError, { readonly tag: 'InvalidPath' }> = result.left as Extract<UploadError, { readonly tag: 'InvalidPath' }>
      expect(err.tag).toBe('InvalidPath')
      expect(err.path).toBe('../escape.md')
    }
  })

  it('rejects null bytes in paths', () => {
    const files: ReadonlyMap<string, string> = new Map([
      ['bad\0path.md', '# Bad']
    ])
    const result: E.Either<UploadError, readonly RelativePath[]> = validateUpload(files)
    expect(E.isLeft(result)).toBe(true)
    if (E.isLeft(result)) {
      const err: Extract<UploadError, { readonly tag: 'InvalidPath' }> = result.left as Extract<UploadError, { readonly tag: 'InvalidPath' }>
      expect(err.tag).toBe('InvalidPath')
    }
  })

  it('returns TooLarge for files over MAX_FILE_SIZE', () => {
    const largeContent: string = 'x'.repeat(MAX_FILE_SIZE + 1)
    const files: ReadonlyMap<string, string> = new Map([
      ['big.md', largeContent]
    ])
    const result: E.Either<UploadError, readonly RelativePath[]> = validateUpload(files)
    expect(E.isLeft(result)).toBe(true)
    if (E.isLeft(result)) {
      expect(result.left.tag).toBe('TooLarge')
    }
  })
})

// ============================================================================
// buildManifest
// ============================================================================

describe('buildManifest', () => {
  it('creates manifest with correct fields', () => {
    const manifest: ShareManifest = buildManifest(
      ['a.md', 'sub/b.md'],
      'my-vault',
      '2025-01-01T00:00:00.000Z'
    )
    expect(manifest.files).toEqual(['a.md', 'sub/b.md'])
    expect(manifest.folderName).toBe('my-vault')
    expect(manifest.createdAt).toBe('2025-01-01T00:00:00.000Z')
  })

  it('filters to only .md paths', () => {
    const manifest: ShareManifest = buildManifest(
      ['a.md', 'image.png', 'sub/b.md', 'config.json'],
      'vault'
    )
    expect(manifest.files).toEqual(['a.md', 'sub/b.md'])
  })

  it('uses provided createdAt', () => {
    const ts: string = '2024-06-15T12:00:00.000Z'
    const manifest: ShareManifest = buildManifest(['note.md'], 'vault', ts)
    expect(manifest.createdAt).toBe(ts)
  })

  it('generates createdAt if not provided', () => {
    const before: string = new Date().toISOString()
    const manifest: ShareManifest = buildManifest(['note.md'], 'vault')
    const after: string = new Date().toISOString()
    expect(manifest.createdAt >= before).toBe(true)
    expect(manifest.createdAt <= after).toBe(true)
  })
})

// ============================================================================
// buildGraphFromFiles
// ============================================================================

describe('buildGraphFromFiles', () => {
  it('builds graph with correct node count', () => {
    const files: ReadonlyMap<string, string> = new Map([
      ['a.md', '# Hello'],
      ['b.md', '# World']
    ])
    const graph: Graph = buildGraphFromFiles(files)
    expect(Object.keys(graph.nodes)).toHaveLength(2)
  })

  it('resolves wikilink edges between nodes', () => {
    const files: ReadonlyMap<string, string> = new Map([
      ['a.md', '# Hello\n\n[[b]]'],
      ['b.md', '# World']
    ])
    const graph: Graph = buildGraphFromFiles(files)
    const nodeA: GraphNode = graph.nodes['a.md']
    expect(nodeA).toBeDefined()
    expect(nodeA.outgoingEdges.length).toBeGreaterThan(0)
    // The edge should resolve to b.md
    const edgeToB: Edge | undefined = nodeA.outgoingEdges.find(e => e.targetId === 'b.md')
    expect(edgeToB).toBeDefined()
  })

  it('handles empty file map (empty graph)', () => {
    const files: ReadonlyMap<string, string> = new Map<string, string>()
    const graph: Graph = buildGraphFromFiles(files)
    expect(Object.keys(graph.nodes)).toHaveLength(0)
  })

  it('node IDs are the RelativePath keys', () => {
    const files: ReadonlyMap<string, string> = new Map([
      ['folder/note.md', '# Note'],
      ['readme.md', '# Readme']
    ])
    const graph: Graph = buildGraphFromFiles(files)
    expect(graph.nodes['folder/note.md']).toBeDefined()
    expect(graph.nodes['readme.md']).toBeDefined()
  })

  it('handles nodes with frontmatter (YAML positions, colors)', () => {
    const files: ReadonlyMap<string, string> = new Map([
      ['styled.md', '---\ncolor: purple\nposition:\n  x: 100\n  y: 200\n---\n# Styled Node']
    ])
    const graph: Graph = buildGraphFromFiles(files)
    const node: GraphNode = graph.nodes['styled.md']
    expect(node).toBeDefined()
    // Content should have frontmatter stripped
    expect(node.contentWithoutYamlOrLinks).not.toContain('color: purple')
    expect(node.contentWithoutYamlOrLinks).toContain('# Styled Node')
  })
})
