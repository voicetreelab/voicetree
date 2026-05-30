import {describe, expect, it} from 'vitest'
import {absolutizeDeclarationPaths, relativizeDeclarationPaths} from './build-context.ts'

// The name-index cache is keyed by HEAD sha but may be built on one checkout
// root and consumed on another (local /Users/... vs the mutagen-synced devbox
// /root/vtrepo-synced/...). Declarations are absolute in memory; the cache must
// be root-relative so a file's identity is root-independent. Otherwise a file
// "collides" with its own cached copy and blocks the commit. Black-box, no I/O.

const decl = (filePath: string) => ({name: 'highWaterMark', filePath, kind: 'export-function' as const})

describe('name-index cache path portability', () => {
    it('round-trips to the same absolute path under the same root', () => {
        const root = '/Users/me/repo'
        const abs = [decl('/Users/me/repo/packages/measures/src/a.ts')]
        const out = absolutizeDeclarationPaths(root, relativizeDeclarationPaths(root, abs))
        expect(out[0].filePath).toBe(abs[0].filePath)
    })

    it('rehydrates a cache built on one root into the consuming root', () => {
        // Cache built locally, persisted relative, then read on the devbox.
        const builtOn = '/Users/me/repo'
        const consumedOn = '/root/vtrepo-synced'
        const persisted = relativizeDeclarationPaths(builtOn, [
            decl('/Users/me/repo/packages/measures/src/_runners/subgraph-gate.ts'),
        ])
        expect(persisted[0].filePath).toBe('packages/measures/src/_runners/subgraph-gate.ts') // root-free
        const rehydrated = absolutizeDeclarationPaths(consumedOn, persisted)
        expect(rehydrated[0].filePath).toBe('/root/vtrepo-synced/packages/measures/src/_runners/subgraph-gate.ts')
    })

    it('gives the SAME identity to the cached and the live copy of one file (no self-collision)', () => {
        // The bug: cached decl (built on /Users) and the live staged scan (on
        // /root) had different absolute paths → two index entries → self-collision.
        // After the fix both resolve to the consuming root and dedupe.
        const consumedOn = '/root/vtrepo-synced'
        const fromCache = absolutizeDeclarationPaths(
            consumedOn,
            relativizeDeclarationPaths('/Users/me/repo', [decl('/Users/me/repo/packages/measures/src/x.ts')]),
        )
        const fromLiveScan = decl('/root/vtrepo-synced/packages/measures/src/x.ts')
        expect(fromCache[0].filePath).toBe(fromLiveScan.filePath)
    })
})
