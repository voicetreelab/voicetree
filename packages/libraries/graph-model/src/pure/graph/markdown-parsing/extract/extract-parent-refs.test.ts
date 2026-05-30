import {describe, it, expect} from 'vitest'
import {extractParentRefs, normalizeBatchFilenameKey} from './extract-parent-refs'

describe('extractParentRefs', () => {
    it('extracts a single parent line with no edge label', () => {
        expect(extractParentRefs('- parent [[rename-plan]]')).toEqual([
            {filename: 'rename-plan', edgeLabel: undefined},
        ])
    })

    it('extracts the edge label after the pipe', () => {
        expect(extractParentRefs('- parent [[rename-plan|implements]]')).toEqual([
            {filename: 'rename-plan', edgeLabel: 'implements'},
        ])
    })

    it('preserves multi-word labels with spaces after the pipe', () => {
        expect(extractParentRefs('- parent [[node-a|blocked by]]')).toEqual([
            {filename: 'node-a', edgeLabel: 'blocked by'},
        ])
    })

    it('splits only on the first pipe; subsequent pipes stay in the label', () => {
        expect(extractParentRefs('- parent [[node-a|a|b]]')).toEqual([
            {filename: 'node-a', edgeLabel: 'a|b'},
        ])
    })

    it('accepts the alternative list markers * and +', () => {
        const markdown: string = '* parent [[a]]\n+ parent [[b|impl]]'
        expect(extractParentRefs(markdown)).toEqual([
            {filename: 'a', edgeLabel: undefined},
            {filename: 'b', edgeLabel: 'impl'},
        ])
    })

    it('accepts a parent line with no list marker', () => {
        expect(extractParentRefs('parent [[node-a|implements]]')).toEqual([
            {filename: 'node-a', edgeLabel: 'implements'},
        ])
    })

    it('accepts an INDENTED parent line (symmetric with extract-edges)', () => {
        expect(extractParentRefs('    - parent [[node-a|impl]]')).toEqual([
            {filename: 'node-a', edgeLabel: 'impl'},
        ])
    })

    it('strips a trailing .md extension from the wikilink target', () => {
        expect(extractParentRefs('- parent [[parent.md]]')).toEqual([
            {filename: 'parent', edgeLabel: undefined},
        ])
        expect(extractParentRefs('- parent [[parent.md|impl]]')).toEqual([
            {filename: 'parent', edgeLabel: 'impl'},
        ])
    })

    it('skips parent lines inside fenced code blocks (triple-backtick)', () => {
        const markdown: string = [
            '- parent [[real]]',
            '```',
            '- parent [[fake]]',
            '```',
            '- parent [[also-real|impl]]',
        ].join('\n')
        expect(extractParentRefs(markdown)).toEqual([
            {filename: 'real', edgeLabel: undefined},
            {filename: 'also-real', edgeLabel: 'impl'},
        ])
    })

    it('skips parent lines inside fenced code blocks (tilde fence)', () => {
        const markdown: string = '~~~\n- parent [[fake]]\n~~~\n- parent [[real]]'
        expect(extractParentRefs(markdown)).toEqual([
            {filename: 'real', edgeLabel: undefined},
        ])
    })

    it('does NOT split pipe on lines whose prefix is not "parent"', () => {
        expect(extractParentRefs('- references [[foo|bar]]')).toEqual([])
    })

    it('returns refs in document order', () => {
        const markdown: string = '- parent [[a|x]]\n\n- parent [[b]]\n- parent [[c|y]]'
        expect(extractParentRefs(markdown)).toEqual([
            {filename: 'a', edgeLabel: 'x'},
            {filename: 'b', edgeLabel: undefined},
            {filename: 'c', edgeLabel: 'y'},
        ])
    })

    it('handles CRLF line endings', () => {
        const markdown: string = '- parent [[a]]\r\n- parent [[b|impl]]\r\n'
        expect(extractParentRefs(markdown)).toEqual([
            {filename: 'a', edgeLabel: undefined},
            {filename: 'b', edgeLabel: 'impl'},
        ])
    })

    it('treats empty edge labels as undefined', () => {
        expect(extractParentRefs('- parent [[a|]]')).toEqual([
            {filename: 'a', edgeLabel: undefined},
        ])
    })

    it('skips empty / malformed targets', () => {
        expect(extractParentRefs('- parent [[]]')).toEqual([])
        expect(extractParentRefs('- parent [[ ]]')).toEqual([])
    })
})

describe('normalizeBatchFilenameKey', () => {
    it('strips .md extension and leading ./', () => {
        expect(normalizeBatchFilenameKey('parent.md')).toBe('parent')
        expect(normalizeBatchFilenameKey('./parent.md')).toBe('parent')
        expect(normalizeBatchFilenameKey('parent')).toBe('parent')
    })

    it('produces the same key for [[parent.md]] and "parent" inputs', () => {
        const parentLineKey: string = extractParentRefs('- parent [[parent.md]]')[0]?.filename ?? ''
        expect(normalizeBatchFilenameKey('parent')).toBe(parentLineKey)
        expect(normalizeBatchFilenameKey('parent.md')).toBe(parentLineKey)
    })
})
