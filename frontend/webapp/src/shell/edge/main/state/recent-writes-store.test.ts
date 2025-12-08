import { describe, it, expect, beforeEach } from 'vitest'
import {
    markFileWritten,
    markFileDeleted,
    isOurRecentWrite,
    clearRecentWrites
} from './recent-writes-store'

describe('recent-writes-store', () => {
    beforeEach(() => {
        clearRecentWrites()
    })

    describe('markFileWritten + isOurRecentWrite', () => {
        it('should acknowledge our own write with matching content', () => {
            markFileWritten('/vault/test.md', '# Hello')
            expect(isOurRecentWrite('/vault/test.md', '# Hello')).toBe(true)
        })

        it('should NOT acknowledge if content differs (external edit)', () => {
            markFileWritten('/vault/test.md', '# Hello')
            expect(isOurRecentWrite('/vault/test.md', '# Modified')).toBe(false)
        })

        it('should NOT acknowledge unknown paths', () => {
            expect(isOurRecentWrite('/vault/unknown.md', '# Content')).toBe(false)
        })

        it('should normalize whitespace differences', () => {
            markFileWritten('/vault/test.md', '# Hello\n\nWorld')
            expect(isOurRecentWrite('/vault/test.md', '# Hello\n\n\nWorld')).toBe(true)
        })

        it('should normalize bracket content differences', () => {
            markFileWritten('/vault/test.md', '# Hello [link1]')
            expect(isOurRecentWrite('/vault/test.md', '# Hello [link2]')).toBe(true)
        })

        it('should distinguish when non-bracket content differs', () => {
            markFileWritten('/vault/test.md', '# Hello [link1] World')
            expect(isOurRecentWrite('/vault/test.md', '# Hello [link1] Universe')).toBe(false)
        })
    })

    describe('markFileDeleted + isOurRecentWrite', () => {
        it('should acknowledge our own delete', () => {
            markFileDeleted('/vault/test.md')
            expect(isOurRecentWrite('/vault/test.md', undefined)).toBe(true)
        })

        it('should NOT acknowledge delete if we wrote content', () => {
            markFileWritten('/vault/test.md', '# Content')
            expect(isOurRecentWrite('/vault/test.md', undefined)).toBe(false)
        })

        it('should NOT acknowledge content event if we deleted', () => {
            markFileDeleted('/vault/test.md')
            expect(isOurRecentWrite('/vault/test.md', '# Some content')).toBe(false)
        })
    })

    describe('TTL expiration', () => {
        it('should NOT acknowledge after 300ms window expires', async () => {
            markFileWritten('/vault/test.md', '# Hello')
            await new Promise(r => setTimeout(r, 350))
            expect(isOurRecentWrite('/vault/test.md', '# Hello')).toBe(false)
        })

        it('should acknowledge within 300ms window', async () => {
            markFileWritten('/vault/test.md', '# Hello')
            await new Promise(r => setTimeout(r, 100))
            expect(isOurRecentWrite('/vault/test.md', '# Hello')).toBe(true)
        })
    })

    describe('FSEvents duplicate handling (no consume on match)', () => {
        it('should allow multiple FSEvents to match same write (macOS fires 2 events)', () => {
            markFileWritten('/vault/test.md', '# Hello')
            // First FSEvent (content change)
            expect(isOurRecentWrite('/vault/test.md', '# Hello')).toBe(true)
            // Second FSEvent (mtime change) - should still match
            expect(isOurRecentWrite('/vault/test.md', '# Hello')).toBe(true)
        })

        it('should allow multiple delete events to match', () => {
            markFileDeleted('/vault/test.md')
            expect(isOurRecentWrite('/vault/test.md', undefined)).toBe(true)
            expect(isOurRecentWrite('/vault/test.md', undefined)).toBe(true)
        })

        it('should NOT match on mismatch, but still match correct content', () => {
            markFileWritten('/vault/test.md', '# Hello')
            expect(isOurRecentWrite('/vault/test.md', '# Wrong')).toBe(false)
            expect(isOurRecentWrite('/vault/test.md', '# Hello')).toBe(true)
        })
    })

    describe('array accumulation within TTL window', () => {
        it('should track multiple writes to same file within window', () => {
            markFileWritten('/vault/test.md', '# First')
            markFileWritten('/vault/test.md', '# Second')
            // Both should match within TTL window
            expect(isOurRecentWrite('/vault/test.md', '# First')).toBe(true)
            expect(isOurRecentWrite('/vault/test.md', '# Second')).toBe(true)
        })

        it('should track write then delete within window', () => {
            markFileWritten('/vault/test.md', '# Content')
            markFileDeleted('/vault/test.md')
            // Both should be present within TTL window
            expect(isOurRecentWrite('/vault/test.md', '# Content')).toBe(true)
            expect(isOurRecentWrite('/vault/test.md', undefined)).toBe(true)
        })

        it('should track delete then write within window', () => {
            markFileDeleted('/vault/test.md')
            markFileWritten('/vault/test.md', '# Content')
            expect(isOurRecentWrite('/vault/test.md', undefined)).toBe(true)
            expect(isOurRecentWrite('/vault/test.md', '# Content')).toBe(true)
        })
    })

    describe('multiple files', () => {
        it('should track multiple files independently', () => {
            markFileWritten('/vault/a.md', '# A')
            markFileWritten('/vault/b.md', '# B')
            markFileDeleted('/vault/c.md')

            expect(isOurRecentWrite('/vault/a.md', '# A')).toBe(true)
            expect(isOurRecentWrite('/vault/b.md', '# B')).toBe(true)
            expect(isOurRecentWrite('/vault/c.md', undefined)).toBe(true)
        })

        it('should not cross-match paths', () => {
            markFileWritten('/vault/a.md', '# Content')
            expect(isOurRecentWrite('/vault/b.md', '# Content')).toBe(false)
        })
    })
})
