import { describe, it, expect } from 'vitest'
import { computeNewNodeIdFromTitle } from './computeNewNodeIdFromTitle'
import type { NodeIdAndFilePath } from '@/pure/graph'

describe('computeNewNodeIdFromTitle', () => {
    describe('snake_case conversion', () => {
        it('converts spaces to underscores', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'My Cool Title',
                'folder/old_name.md',
                new Set()
            )
            expect(result).toBe('folder/my_cool_title.md')
        })

        it('converts to lowercase', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'UPPERCASE',
                'folder/old.md',
                new Set()
            )
            expect(result).toBe('folder/uppercase.md')
        })

        it('handles mixed case with spaces', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'Hello World',
                'docs/readme.md',
                new Set()
            )
            expect(result).toBe('docs/hello_world.md')
        })
    })

    describe('special character stripping', () => {
        it('strips special characters', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'Hello! World? #123',
                'folder/old.md',
                new Set()
            )
            expect(result).toBe('folder/hello_world_123.md')
        })

        it('handles multiple special characters in a row', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'Test!!!Multiple---Chars',
                'folder/old.md',
                new Set()
            )
            expect(result).toBe('folder/test_multiple_chars.md')
        })

        it('preserves underscores in title', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'hello_world',
                'folder/old.md',
                new Set()
            )
            expect(result).toBe('folder/hello_world.md')
        })
    })

    describe('folder prefix preservation', () => {
        it('preserves folder prefix from currentNodeId', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'New Title',
                'tues/old_name.md',
                new Set()
            )
            expect(result).toBe('tues/new_title.md')
        })

        it('handles nested folder paths', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'New Title',
                'deep/nested/folder/old.md',
                new Set()
            )
            expect(result).toBe('deep/nested/folder/new_title.md')
        })

        it('handles root level nodes (no folder)', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'New Title',
                'old_name.md',
                new Set()
            )
            expect(result).toBe('new_title.md')
        })
    })

    describe('conflict resolution with suffix', () => {
        it('appends _2 if ID already exists', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'My Cool Title',
                'tues/old_name.md',
                new Set(['tues/my_cool_title.md'])
            )
            expect(result).toBe('tues/my_cool_title_2.md')
        })

        it('appends _3 if _2 also exists', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'My Cool Title',
                'tues/old_name.md',
                new Set(['tues/my_cool_title.md', 'tues/my_cool_title_2.md'])
            )
            expect(result).toBe('tues/my_cool_title_3.md')
        })

        it('finds first available suffix', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'Test',
                'folder/old.md',
                new Set(['folder/test.md', 'folder/test_2.md', 'folder/test_3.md'])
            )
            expect(result).toBe('folder/test_4.md')
        })

        it('returns base ID if no conflict', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'Unique Title',
                'folder/old.md',
                new Set(['folder/other.md'])
            )
            expect(result).toBe('folder/unique_title.md')
        })
    })

    describe('empty title handling', () => {
        it('returns untitled.md for empty string', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                '',
                'folder/old.md',
                new Set()
            )
            expect(result).toBe('folder/untitled.md')
        })

        it('returns untitled.md for whitespace-only string', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                '   ',
                'folder/old.md',
                new Set()
            )
            expect(result).toBe('folder/untitled.md')
        })

        it('handles conflict with untitled.md', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                '',
                'folder/old.md',
                new Set(['folder/untitled.md'])
            )
            expect(result).toBe('folder/untitled_2.md')
        })
    })

    describe('edge cases', () => {
        it('handles title that becomes empty after stripping special chars', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                '!!!@@@###',
                'folder/old.md',
                new Set()
            )
            expect(result).toBe('folder/untitled.md')
        })

        it('collapses multiple consecutive underscores', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                'hello   world',
                'folder/old.md',
                new Set()
            )
            expect(result).toBe('folder/hello_world.md')
        })

        it('trims leading/trailing underscores', () => {
            const result: NodeIdAndFilePath = computeNewNodeIdFromTitle(
                '  hello world  ',
                'folder/old.md',
                new Set()
            )
            expect(result).toBe('folder/hello_world.md')
        })
    })
})
