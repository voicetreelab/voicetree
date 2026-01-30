/**
 * Unit tests for saveClipboardImage IPC handler
 * TDD: Tests written before implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

// Use vi.hoisted to create mocks that are available to vi.mock factories
const { mockWriteFileSync, mockReadImage } = vi.hoisted(() => ({
  mockWriteFileSync: vi.fn() as Mock,
  mockReadImage: vi.fn() as Mock,
}))

// Mock electron clipboard
vi.mock('electron', () => ({
  clipboard: {
    readImage: mockReadImage,
  },
}))

// Mock node:fs with synchronous factory
vi.mock('node:fs', () => ({
  writeFileSync: mockWriteFileSync,
  default: {
    writeFileSync: mockWriteFileSync,
  },
}))

// Import after mocks - vitest hoists vi.mock calls above imports
import { saveClipboardImage } from './saveClipboardImage'

describe('saveClipboardImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when clipboard contains no image', () => {
    mockReadImage.mockReturnValue({
      isEmpty: () => true,
      toPNG: () => Buffer.from([]),
    })

    const result: string | null = saveClipboardImage('/path/to/notes/my-note.md')

    expect(result).toBeNull()
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('should save image and return relative filename when clipboard has image', () => {
    const mockPngBuffer: Buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]) // PNG magic bytes

    // Mock Date.now() for deterministic filename
    const mockTimestamp: number = 1705123456789
    vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp)

    mockReadImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => mockPngBuffer,
    })

    const result: string | null = saveClipboardImage('/path/to/notes/my-note.md')

    expect(result).toBe('pasted-1705123456789.png')
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/path/to/notes/pasted-1705123456789.png',
      mockPngBuffer
    )
  })

  it('should derive save folder from markdown file path', () => {
    const mockPngBuffer: Buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47])

    const mockTimestamp: number = 1705123456789
    vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp)

    mockReadImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => mockPngBuffer,
    })

    // Test with nested path
    saveClipboardImage('/Users/bob/vault/subfolder/deep/note.md')

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/Users/bob/vault/subfolder/deep/pasted-1705123456789.png',
      mockPngBuffer
    )
  })

  it('should generate timestamp-based unique filenames', () => {
    const mockPngBuffer: Buffer = Buffer.from([0x89, 0x50, 0x4E, 0x47])

    mockReadImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => mockPngBuffer,
    })

    // First call
    vi.spyOn(Date, 'now').mockReturnValue(1000000000000)
    const result1: string | null = saveClipboardImage('/path/note.md')

    // Second call with different timestamp
    vi.spyOn(Date, 'now').mockReturnValue(1000000000001)
    const result2: string | null = saveClipboardImage('/path/note.md')

    expect(result1).toBe('pasted-1000000000000.png')
    expect(result2).toBe('pasted-1000000000001.png')
    expect(result1).not.toBe(result2)
  })
})
