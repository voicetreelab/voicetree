import {describe, expect, it} from 'vitest'
import {isCacheBuiltForRoot} from './build-context.ts'

// The name-index cache stores absolute paths and is machine-local (the
// mutagen sync excludes `.voicetree/cache/`). A cache whose paths don't sit
// under the current checkout root was built elsewhere or copied in, and must
// be rebuilt — otherwise a file would appear to collide with its own
// out-of-tree copy. Black-box, no I/O.

const decl = (filePath: string) => ({name: 'highWaterMark', filePath, kind: 'export-function' as const})

describe('isCacheBuiltForRoot', () => {
    it('accepts a cache whose paths all sit under the current root', () => {
        const root = '/root/vtrepo-synced'
        expect(isCacheBuiltForRoot([decl('/root/vtrepo-synced/packages/a.ts')], root)).toBe(true)
    })

    it('rejects a cache built under a different root (foreign machine / moved checkout)', () => {
        // Built on a dev mac, read on the devbox: identities would not match
        // the live scan, so the cache must be discarded and rebuilt.
        const root = '/root/vtrepo-synced'
        expect(isCacheBuiltForRoot([decl('/Users/me/repo/packages/a.ts')], root)).toBe(false)
    })

    it('does not treat a sibling root sharing a prefix as the same checkout', () => {
        expect(isCacheBuiltForRoot([decl('/root/vtrepo-synced-old/packages/a.ts')], '/root/vtrepo-synced')).toBe(false)
    })
})
