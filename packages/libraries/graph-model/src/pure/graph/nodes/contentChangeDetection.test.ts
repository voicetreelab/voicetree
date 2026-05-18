import { describe, it, expect } from 'vitest'
import { stripBracketedContent, hasActualContentChanged, isAppendOnly, getAppendedSuffix } from './contentChangeDetection'

describe('stripBracketedContent', () => {
    describe('double brackets (wikilinks)', () => {
        it('removes wikilink including brackets and content', () => {
            expect(stripBracketedContent('Hello [[node.md]] world')).toBe('Hello  world')
        })

        it('removes multiple wikilinks', () => {
            expect(stripBracketedContent('[[a.md]] and [[b.md]]')).toBe(' and ')
        })

        it('removes empty wikilink', () => {
            expect(stripBracketedContent('Hello [[]] world')).toBe('Hello  world')
        })
    })

    describe('single brackets (markdown links)', () => {
        it('removes single bracket link including brackets and content', () => {
            expect(stripBracketedContent('Hello [link] world')).toBe('Hello  world')
        })

        it('removes multiple single bracket links', () => {
            expect(stripBracketedContent('[a] and [b]')).toBe(' and ')
        })

        it('removes empty single bracket', () => {
            expect(stripBracketedContent('Hello [] world')).toBe('Hello  world')
        })
    })

    describe('mixed brackets', () => {
        it('removes both wikilinks and single brackets', () => {
            expect(stripBracketedContent('[[wiki]] and [link]')).toBe(' and ')
        })

        it('wikilink regex stops at first ] - leaving trailing bracket', () => {
            // [[a][b]] - regex \[\[[^\]]*\]\] matches [[a] then looks for ]] but finds [b]]
            // Actually: [^\]]* stops at first ], so [[a] is NOT a valid wikilink match
            // Let's trace: \[\[ matches [[, then [^\]]* matches 'a', then \]\] needs ]] but finds ][
            // So the wikilink regex doesn't match, falls through to single bracket
            // Single bracket: \[[^\]]*\] matches [a], leaving [b]]
            // Then matches [b], leaving ]
            expect(stripBracketedContent('text [[a][b]] more')).toBe('text ] more')
        })
    })

    describe('edge cases', () => {
        it('handles unclosed brackets - single open bracket preserved', () => {
            // [^\]]* means "any char except ]", so unclosed [ stays
            expect(stripBracketedContent('Hello [ world')).toBe('Hello [ world')
        })

        it('handles unclosed wikilink - [[ preserved', () => {
            expect(stripBracketedContent('Hello [[ world')).toBe('Hello [[ world')
        })

        it('handles nested-looking content', () => {
            // [[outer [inner] ]] - the [^\]]* stops at first ]
            // So [[outer [inner] matches, leaving ]]
            expect(stripBracketedContent('[[outer [inner] ]]')).toBe(' ]]')
        })

        it('strips content with newlines inside brackets', () => {
            // JS regex [^\]]* DOES match newlines (unlike some regex flavors)
            expect(stripBracketedContent('[[multi\nline]]')).toBe('')
        })

        it('preserves text outside brackets', () => {
            expect(stripBracketedContent('prefix [[link]] suffix')).toBe('prefix  suffix')
        })

        it('returns empty string when content is only brackets', () => {
            expect(stripBracketedContent('[[only]]')).toBe('')
        })
    })
})

describe('hasActualContentChanged', () => {
    it('returns false when only wikilink changed', () => {
        expect(hasActualContentChanged(
            'Hello [[old.md]] world',
            'Hello [[new.md]] world'
        )).toBe(false)
    })

    it('returns true when text outside brackets changed', () => {
        expect(hasActualContentChanged(
            'Hello [[link]] world',
            'Hello [[link]] universe'
        )).toBe(true)
    })

    it('BUG: returns TRUE when link added due to whitespace difference', () => {
        // 'Hello world' → 'Hello world' (stripped)
        // 'Hello [[link]] world' → 'Hello  world' (stripped - DOUBLE SPACE!)
        // These differ, so hasActualContentChanged returns true
        // This may cause false positives in race condition detection
        expect(hasActualContentChanged(
            'Hello world',
            'Hello [[link]] world'
        )).toBe(true)
    })

    it('BUG: returns TRUE when link removed due to whitespace difference', () => {
        // Same issue in reverse
        expect(hasActualContentChanged(
            'Hello [[link]] world',
            'Hello world'
        )).toBe(true)
    })

    it('BUG: even appending link causes whitespace diff', () => {
        // 'Hello world' → 'Hello world'
        // 'Hello world [[link]]' → 'Hello world ' (trailing space!)
        expect(hasActualContentChanged(
            'Hello world',
            'Hello world [[link]]'
        )).toBe(true)
    })

    it('returns false when link replaced with same whitespace', () => {
        // Both have the same surrounding whitespace pattern
        expect(hasActualContentChanged(
            'Hello [[old]] world',
            'Hello [[new]] world'
        )).toBe(false)
    })
})

describe('isAppendOnly', () => {
    it('returns true when content is appended', () => {
        expect(isAppendOnly('Hello', 'Hello world')).toBe(true)
    })

    it('returns false when content is prepended', () => {
        expect(isAppendOnly('world', 'Hello world')).toBe(false)
    })

    it('returns false when content changed', () => {
        expect(isAppendOnly('Hello', 'Goodbye')).toBe(false)
    })

    it('returns false when same content', () => {
        expect(isAppendOnly('Hello', 'Hello')).toBe(false)
    })
})

describe('getAppendedSuffix', () => {
    it('returns the appended portion', () => {
        expect(getAppendedSuffix('Hello', 'Hello world')).toBe(' world')
    })

    it('returns appended link', () => {
        expect(getAppendedSuffix('Content', 'Content\n[[link.md]]')).toBe('\n[[link.md]]')
    })
})
