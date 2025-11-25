import { describe, it, expect } from 'vitest'
import {
  filenameToNodeId,
  nodeIdToFilePathWithExtension
} from '@/pure/graph/markdown-parsing/filename-utils.ts'

describe('filename-utils', () => {
  describe('filenameToNodeId', () => {
    it('should keep filename as-is (identity function)', () => {
      expect(filenameToNodeId('my-note.md')).toBe('my-note.md')
      expect(filenameToNodeId('no-extension')).toBe('no-extension')
      expect(filenameToNodeId('')).toBe('')
    })

    it('should handle nested paths', () => {
      expect(filenameToNodeId('folder/subfolder/note.md')).toBe('folder/subfolder/note.md')
    })

    it('should handle edge cases (special chars, unicode, spaces, multiple dots)', () => {
      expect(filenameToNodeId('note-with-$pecial_chars@2024.md')).toBe('note-with-$pecial_chars@2024.md')
      expect(filenameToNodeId('日本語 note.md')).toBe('日本語 note.md')
      expect(filenameToNodeId('file.backup.md')).toBe('file.backup.md')
    })
  })

  describe('nodeIdToFilename', () => {
    it('should add .md extension when missing, keep when present', () => {
      expect(nodeIdToFilePathWithExtension('my-note')).toBe('my-note.md')
      expect(nodeIdToFilePathWithExtension('already-has.md')).toBe('already-has.md')
      expect(nodeIdToFilePathWithExtension('')).toBe('.md')
    })

    it('should handle nested paths', () => {
      expect(nodeIdToFilePathWithExtension('folder/subfolder/note')).toBe('folder/subfolder/note.md')
    })

    it('should handle edge cases (special chars, unicode, spaces, multiple dots)', () => {
      expect(nodeIdToFilePathWithExtension('note-with-$pecial_chars@2024')).toBe('note-with-$pecial_chars@2024.md')
      expect(nodeIdToFilePathWithExtension('日本語 note')).toBe('日本語 note.md')
      expect(nodeIdToFilePathWithExtension('note.with.dots')).toBe('note.with.dots.md')
    })
  })
})
