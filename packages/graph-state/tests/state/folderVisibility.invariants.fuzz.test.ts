/**
 * BF-236 Phase 0 — totality fuzz for folderVisibility derivation.
 *
 * Property: every legacy snapshot — including non-canonical inputs (orphans,
 * disjoint readPaths/loadedRoots, collapse-overrides-expand, paths with or
 * without trailing slash) — produces a non-throwing derivation whose values
 * are all in {'expanded','collapsed'} (never 'hidden', since 'hidden' is the
 * default-by-absence).
 *
 * Also asserts:
 *   - implicit roots and watch roots never throw on derived maps.
 *   - derived row count ≤ |readPaths ∪ loadedRoots ∪ collapseSet|
 *     (no row-count blow-up).
 */

import { describe, expect, it } from 'vitest'

import {
    deriveFolderVisibilityFromLegacy,
    ensureTrailingSlash,
    stripTrailingSlash,
} from '../../src/state/folderVisibility/derive'
import {
    deriveImplicitRoots,
    deriveWatchRoots,
} from '../../src/state/folderVisibility/implicitRoots'
import type { LegacyVisibilitySnapshot } from '../../src/state/folderVisibility/types'

function mulberry32(seed: number): () => number {
    let a = seed
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// Adversarial path pool: trailing slashes, missing parents (orphans), deep nesting.
const ADVERSARIAL_PATHS: readonly string[] = [
    '/',
    '/v',
    '/v/',
    '/v/a',
    '/v/a/',
    '/v/a/b/c',
    '/v/a/b/c/',
    '/orphan',
    '/orphan-deep/x/y/z',     // intentionally no parents in any other set
    '/dup',
    '/dup/',                  // path with and without trailing slash
    '/disjoint-1',
    '/disjoint-2/sub',
]

function genWildLegacy(rng: () => number): LegacyVisibilitySnapshot {
    const readPaths = new Set<string>()
    const loadedRoots = new Set<string>()
    const collapseSet = new Set<string>()
    for (const p of ADVERSARIAL_PATHS) {
        const r = rng()
        if (r < 0.30) readPaths.add(p)
        if (r > 0.50 && r < 0.80) loadedRoots.add(p)
        if (rng() < 0.30) collapseSet.add(ensureTrailingSlash(p))
    }
    return { readPaths, loadedRoots, collapseSet }
}

describe('folderVisibility derivation — totality (no throw, well-formed output)', () => {
    it('1000 wild legacy snapshots derive without throwing; values ∈ {expanded, collapsed}', () => {
        const SEED = 0xFEEDFACE
        const RUNS = 1000
        const topRng = mulberry32(SEED)

        for (let r = 0; r < RUNS; r++) {
            const seqSeed = (topRng() * 0xFFFFFFFF) >>> 0
            const seqRng = mulberry32(seqSeed)
            const legacy = genWildLegacy(seqRng)

            // Must not throw.
            const map = deriveFolderVisibilityFromLegacy(legacy)

            const ctx = `run=${r} seed=0x${seqSeed.toString(16)}`
            for (const [, v] of map) {
                expect(['expanded', 'collapsed'], `${ctx} value`).toContain(v)
            }

            // Row count ≤ |readPaths ∪ loadedRoots ∪ collapseSet| (after path-norm).
            const inputUnion = new Set<string>()
            for (const p of legacy.readPaths) inputUnion.add(stripTrailingSlash(p))
            for (const p of legacy.loadedRoots) inputUnion.add(stripTrailingSlash(p))
            for (const p of legacy.collapseSet) inputUnion.add(stripTrailingSlash(p))
            expect(map.size, `${ctx} no row blow-up`).toBeLessThanOrEqual(inputUnion.size)

            // implicit roots + watch roots never throw and yield AbsolutePaths only.
            const roots = deriveImplicitRoots(map)
            const watch = deriveWatchRoots(map)
            for (const p of roots) expect(typeof p, ctx).toBe('string')
            for (const p of watch) expect(typeof p, ctx).toBe('string')
            // watchRoots ⊆ {p | map.get(p)='expanded'}
            for (const p of watch) {
                expect(map.get(p), `${ctx} watch ⊆ expanded`).toBe('expanded')
            }
        }
    })

    it('empty legacy snapshot derives to empty map and empty derived sets', () => {
        const map = deriveFolderVisibilityFromLegacy({
            readPaths: new Set(),
            loadedRoots: new Set(),
            collapseSet: new Set(),
        })
        expect(map.size).toBe(0)
        expect(deriveImplicitRoots(map).size).toBe(0)
        expect(deriveWatchRoots(map).size).toBe(0)
    })
})
