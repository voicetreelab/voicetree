import { describe, it, expect } from 'vitest'
import { nodeBasename } from './nodeBasename'

describe('nodeBasename', () => {
    it('returns the final segment of an absolute path', () => {
        expect(nodeBasename('/project/a/Foo.md')).toBe('Foo.md')
    })

    it('strips the given extension while preserving case', () => {
        expect(nodeBasename('/project/a/Foo.md', '.md')).toBe('Foo')
        expect(nodeBasename('/Users/x/voicetree-phone/node_5pi2p0.md', '.md')).toBe('node_5pi2p0')
    })

    it('handles a bare filename with no directory', () => {
        expect(nodeBasename('Foo.md', '.md')).toBe('Foo')
    })

    it('handles backslash separators', () => {
        expect(nodeBasename('C:\\notes\\Bar.md', '.md')).toBe('Bar')
    })

    it('does not strip when the segment is exactly the extension', () => {
        expect(nodeBasename('/project/.md', '.md')).toBe('.md')
    })

    it('leaves a non-matching extension intact', () => {
        expect(nodeBasename('/project/a/image.png', '.md')).toBe('image.png')
    })
})
