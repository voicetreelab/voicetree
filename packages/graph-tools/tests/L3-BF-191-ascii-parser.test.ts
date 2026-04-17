import {describe, expect, it} from 'vitest'
import {parseAscii} from '../scripts/L3-BF-191-ascii-parser'

describe('L3-BF-191 ascii parser', () => {
    it('parses legacy inline arrows and the authoritative [Cross-Links] footer', () => {
        const ascii: string = [
            '· Root',
            '    ⇢ Child',
            '',
            '[Cross-Links]',
            'folder/note -> root',
            'root -> child',
            'root -> ?missing-link',
            '',
            'Legend: ▣ folder (with folder note)   ▢ virtual folder   · file   ⇢ wikilink',
        ].join('\n')

        const parsed = parseAscii(ascii)

        expect(parsed.inlineEdges).toEqual([
            {
                srcLine: 0,
                srcTitle: 'Root',
                srcFolderPath: '',
                targetTitle: 'Child',
            },
        ])
        expect(parsed.footerEdges).toEqual([
            {srcId: 'folder/note', targetId: 'root', unresolved: false},
            {srcId: 'root', targetId: 'child', unresolved: false},
            {srcId: 'root', targetId: 'missing-link', unresolved: true},
        ])
        expect(parsed.footerStartLine).toBe(3)
        expect(parsed.droppedLines).toEqual([])
    })
})
