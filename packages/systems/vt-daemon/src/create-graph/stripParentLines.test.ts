import {describe, it, expect} from 'vitest'
import {stripParentLines} from './createGraphBatch'

describe('stripParentLines', () => {
    it('returns undefined / empty input untouched', () => {
        expect(stripParentLines(undefined)).toBeUndefined()
        expect(stripParentLines('')).toBe('')
    })

    it('removes a strict `- parent [[X]]` line and preserves surrounding content', () => {
        const input: string = 'Prose paragraph.\n\n- parent [[X|impl]]\n\nMore prose.'
        expect(stripParentLines(input)).toBe('Prose paragraph.\n\nMore prose.')
    })

    it('removes multiple adjacent parent lines (each consumes its own EOL)', () => {
        const input: string = '- parent [[a]]\n- parent [[b|impl]]\n- parent [[c]]\nbody'
        expect(stripParentLines(input)).toBe('body')
    })

    it('strips a parent line at EOF with no trailing newline', () => {
        const input: string = 'body\n- parent [[a|impl]]'
        // split/join on \n preserves the absence of a trailing newline.
        expect(stripParentLines(input)).toBe('body')
    })

    it('collapses 3+ blank lines back down to a single blank-line gap', () => {
        const input: string = 'before\n\n\n- parent [[a]]\n\n\nafter'
        const stripped: string = stripParentLines(input) ?? ''
        expect(stripped).not.toContain('\n\n\n')
        expect(stripped).toContain('before')
        expect(stripped).toContain('after')
    })

    it('strips trailing whitespace + CRLF endings', () => {
        const input: string = 'before\r\n- parent [[a|impl]]   \r\nafter\r\n'
        const stripped: string = stripParentLines(input) ?? ''
        expect(stripped).toContain('before')
        expect(stripped).toContain('after')
        expect(stripped).not.toMatch(/- parent/)
    })

    it('strips INDENTED parent lines symmetrically with extract-edges acceptance', () => {
        const input: string = 'before\n    - parent [[a|impl]]\nafter'
        const stripped: string = stripParentLines(input) ?? ''
        expect(stripped).not.toMatch(/- parent/)
        expect(stripped).toContain('before')
        expect(stripped).toContain('after')
    })

    it('PRESERVES parent lines inside triple-backtick fenced code blocks', () => {
        const input: string = [
            'before',
            '```',
            '- parent [[fenced|do-not-touch]]',
            '```',
            'after',
            '- parent [[real]]',
        ].join('\n')
        const stripped: string = stripParentLines(input) ?? ''
        expect(stripped).toContain('- parent [[fenced|do-not-touch]]')
        expect(stripped).not.toContain('- parent [[real]]')
    })

    it('PRESERVES parent lines inside tilde fenced code blocks', () => {
        const input: string = '~~~\n- parent [[fenced]]\n~~~\n- parent [[real]]'
        const stripped: string = stripParentLines(input) ?? ''
        expect(stripped).toContain('- parent [[fenced]]')
        expect(stripped).not.toContain('- parent [[real]]')
    })

    it('leaves non-parent lines that look similar (e.g. `- references [[foo|bar]]`)', () => {
        const input: string = '- references [[foo|bar]]\nbody'
        expect(stripParentLines(input)).toBe(input)
    })
})
