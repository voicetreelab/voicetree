import { describe, it, expect } from 'vitest'
import {
  filenameToNodeId,
  nodeIdToFilePathWithExtension
} from '@/pure/graph/markdown-parsing/filename-utils.ts'

describe('filename-utils', () => {
  describe('filenameToNodeId', () => {
    it('should remove .md extension from simple filename', () => {
      const filename = 'my-note.md'

      const result = filenameToNodeId(filename)

      expect(result).toBe('my-note')
    })

    it('should remove .md extension from filename with absolutePath', () => {
      const filename = 'subfolder/my-note.md'

      const result = filenameToNodeId(filename)

      expect(result).toBe('subfolder/my-note')
    })

    it('should remove .md extension from deeply nested absolutePath', () => {
      const filename = 'folder/subfolder/deeply/nested/note.md'

      const result = filenameToNodeId(filename)

      expect(result).toBe('folder/subfolder/deeply/nested/note')
    })

    it('should return filename as-is when no .md extension', () => {
      const filename = 'no-extension'

      const result = filenameToNodeId(filename)

      expect(result).toBe('no-extension')
    })

    it('should remove .md extension from double extension filename', () => {
      const filename = 'file.backup.md'

      const result = filenameToNodeId(filename)

      expect(result).toBe('file.backup')
    })

    it('should handle filename that is just .md (results in empty string)', () => {
      const filename = '.md'

      const result = filenameToNodeId(filename)

      expect(result).toBe('')
    })

    it('should handle empty string', () => {
      const filename = ''

      const result = filenameToNodeId(filename)

      expect(result).toBe('')
    })

    it('should remove .md extension from filename with special characters', () => {
      const filename = 'note-with-$pecial_chars@2024.md'

      const result = filenameToNodeId(filename)

      expect(result).toBe('note-with-$pecial_chars@2024')
    })

    it('should remove .md extension from filename with unicode characters', () => {
      const filename = '日本語ノート.md'

      const result = filenameToNodeId(filename)

      expect(result).toBe('日本語ノート')
    })

    it('should remove .md extension from filename with spaces', () => {
      const filename = 'my note with spaces.md'

      const result = filenameToNodeId(filename)

      expect(result).toBe('my note with spaces')
    })

    it('should preserve case-sensitive .MD extension', () => {
      const filename = 'note.MD'

      const result = filenameToNodeId(filename)

      expect(result).toBe('note.MD')
    })

    it('should remove only trailing .md from filename with .md appearing multiple times', () => {
      const filename = 'note.md.backup.md'

      const result = filenameToNodeId(filename)

      expect(result).toBe('note.md.backup')
    })
  })

  describe('nodeIdToFilename', () => {
    it('should add .md extension to simple node ID without extension', () => {
      const nodeId = 'my-note'

      const result = nodeIdToFilePathWithExtension(nodeId)

      expect(result).toBe('my-note.md')
    })

    it('should add .md extension to node ID with absolutePath but no extension', () => {
      const nodeId = 'subfolder/my-note'

      const result = nodeIdToFilePathWithExtension(nodeId)

      expect(result).toBe('subfolder/my-note.md')
    })

    it('should add .md extension to deeply nested absolutePath without extension', () => {
      const nodeId = 'folder/subfolder/deeply/nested/note'

      const result = nodeIdToFilePathWithExtension(nodeId)

      expect(result).toBe('folder/subfolder/deeply/nested/note.md')
    })

    it('should add .md even if node ID already has .md (creates double extension)', () => {
      const nodeId = 'already-has.md'

      const result = nodeIdToFilePathWithExtension(nodeId)

      expect(result).toBe('already-has.md.md')
    })

    it('should add .md to empty string', () => {
      const nodeId = ''

      const result = nodeIdToFilePathWithExtension(nodeId)

      expect(result).toBe('.md')
    })

    it('should add .md to node ID with special characters', () => {
      const nodeId = 'note-with-$pecial_chars@2024'

      const result = nodeIdToFilePathWithExtension(nodeId)

      expect(result).toBe('note-with-$pecial_chars@2024.md')
    })

    it('should add .md to node ID with unicode characters', () => {
      const nodeId = '日本語ノート'

      const result = nodeIdToFilePathWithExtension(nodeId)

      expect(result).toBe('日本語ノート.md')
    })

    it('should add .md to node ID with spaces', () => {
      const nodeId = 'my note with spaces'

      const result = nodeIdToFilePathWithExtension(nodeId)

      expect(result).toBe('my note with spaces.md')
    })

    it('should add .md to node ID with dots but no .md extension', () => {
      const nodeId = 'note.with.dots'

      const result = nodeIdToFilePathWithExtension(nodeId)

      expect(result).toBe('note.with.dots.md')
    })

    it('should be inverse of filenameToNodeId for standard cases', () => {
      const originalFilename = 'test-note.md'

      const nodeId = filenameToNodeId(originalFilename)
      const backToFilename = nodeIdToFilePathWithExtension(nodeId)

      expect(backToFilename).toBe(originalFilename)
    })

    it('should roundtrip correctly for paths', () => {
      const originalFilename = 'folder/subfolder/note.md'

      const nodeId = filenameToNodeId(originalFilename)
      const backToFilename = nodeIdToFilePathWithExtension(nodeId)

      expect(backToFilename).toBe(originalFilename)
    })

    it('should add .md even when node ID already has it (creates double extension)', () => {
      const nodeId = 'file.backup.md'

      const result = nodeIdToFilePathWithExtension(nodeId)

      expect(result).toBe('file.backup.md.md')
    })
  })
})
