import { describe, it, expect } from 'vitest'
import { replaceWikilinkPlaceholders } from './replaceWikilinkPlaceholders'

describe('replaceWikilinkPlaceholders', () => {
    describe('basic replacement', () => {
        it('replaces matching placeholder with new basename', () => {
            const content: string = 'See [my_node]* for details'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/my_node.md',
                'folder/new_title.md'
            )
            expect(result).toBe('See [new_title]* for details')
        })

        it('replaces placeholder matching just basename', () => {
            const content: string = 'Check [other_file]* here'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'deep/folder/other_file.md',
                'deep/folder/renamed.md'
            )
            expect(result).toBe('Check [renamed]* here')
        })

        it('replaces placeholder matching relative path', () => {
            const content: string = 'Link to [folder/my_node]* works'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/my_node.md',
                'folder/new_name.md'
            )
            expect(result).toBe('Link to [new_name]* works')
        })

        it('replaces placeholder matching full path', () => {
            const content: string = 'Full path [folder/my_node.md]* link'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/my_node.md',
                'folder/new_name.md'
            )
            expect(result).toBe('Full path [new_name]* link')
        })
    })

    describe('multiple placeholders', () => {
        it('replaces all matching placeholders', () => {
            const content: string = 'First [my_node]* and second [my_node]* references'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/my_node.md',
                'folder/renamed.md'
            )
            expect(result).toBe('First [renamed]* and second [renamed]* references')
        })

        it('only replaces matching placeholders, preserves others', () => {
            const content: string = 'Links: [my_node]* and [other_node]* and [my_node]*'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/my_node.md',
                'folder/new_title.md'
            )
            expect(result).toBe('Links: [new_title]* and [other_node]* and [new_title]*')
        })
    })

    describe('no matching placeholders', () => {
        it('returns content unchanged when no placeholders match', () => {
            const content: string = 'Link to [unrelated_node]* here'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/my_node.md',
                'folder/new_title.md'
            )
            expect(result).toBe('Link to [unrelated_node]* here')
        })

        it('returns content unchanged when no placeholders exist', () => {
            const content: string = 'Plain text without any links'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/my_node.md',
                'folder/new_title.md'
            )
            expect(result).toBe('Plain text without any links')
        })
    })

    describe('edge cases', () => {
        it('handles empty content', () => {
            const result: string = replaceWikilinkPlaceholders(
                '',
                'folder/my_node.md',
                'folder/new_title.md'
            )
            expect(result).toBe('')
        })

        it('handles content with only a matching placeholder', () => {
            const result: string = replaceWikilinkPlaceholders(
                '[my_node]*',
                'folder/my_node.md',
                'folder/new_name.md'
            )
            expect(result).toBe('[new_name]*')
        })

        it('handles newlines in content', () => {
            const content: string = '# Title\n\nSee [my_node]* for details\n\nMore text'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/my_node.md',
                'folder/new_title.md'
            )
            expect(result).toBe('# Title\n\nSee [new_title]* for details\n\nMore text')
        })

        it('handles placeholder with .md extension', () => {
            const content: string = 'Link [my_node.md]* here'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/my_node.md',
                'folder/renamed.md'
            )
            expect(result).toBe('Link [renamed]* here')
        })

        it('handles new node ID without .md extension in basename output', () => {
            // The output should always be basename without .md
            const content: string = 'Link [old_name]* here'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/old_name.md',
                'folder/new_name.md'
            )
            expect(result).toBe('Link [new_name]* here')
        })
    })

    describe('linkMatchScore edge cases', () => {
        it('matches despite different folder paths when basename matches', () => {
            // linkMatchScore returns 1 for basename-only match
            const content: string = 'Reference [my_file]* here'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'different/path/my_file.md',
                'different/path/renamed.md'
            )
            expect(result).toBe('Reference [renamed]* here')
        })

        it('does not match when basenames differ', () => {
            const content: string = 'Link [my_file]* here'
            const result: string = replaceWikilinkPlaceholders(
                content,
                'folder/other_file.md',
                'folder/renamed.md'
            )
            expect(result).toBe('Link [my_file]* here')
        })
    })
})
