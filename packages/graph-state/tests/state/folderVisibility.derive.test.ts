/**
 * BF-236 Phase 0 — round-trip property tests for the unified folder-visibility
 * derivation. Proves total + reversible:
 *
 *   forward  : legacy {readPaths, loadedRoots, collapseSet} -> Map<path, state>
 *   inverse  : Map<path, state> -> legacy {readPaths, loadedRoots, collapseSet}
 *   identity : inverse(forward(legacy)) ≡ canonicalise(legacy)
 *
 * Seeded PRNG (Mulberry32) borrowed from `tests/invariants.fuzz.test.ts` so
 * failures are deterministic and re-runnable from the printed seed.
 *
 * Required seed cases (BF-236 spec):
 *   1. empty state
 *   2. single read-path
 *   3. single collapse (collapsed-under-expand)
 *   4. disjoint roots
 *   5. deep collapse-under-expand
 *   6. collapse-overrides-expand (folder in both readPaths and collapseSet)
 */

import { describe, expect, it } from 'vitest'

import {
    deriveFolderVisibilityFromLegacy,
    deriveLegacyFromFolderVisibility,
    ensureTrailingSlash,
    stripTrailingSlash,
} from '../../src/state/folderVisibility/derive'
import {
    deriveImplicitRoots,
    deriveWatchRoots,
} from '../../src/state/folderVisibility/implicitRoots'
import type {
    FolderVisibilityState,
    LegacyVisibilitySnapshot,
} from '../../src/state/folderVisibility/types'

// ---- Mulberry32 seeded PRNG (deterministic replay) ----

function mulberry32(seed: number): () => number {
    let a = seed
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// ---- Path arbitrary: a small finite tree with realistic paths ----

const PATH_POOL: readonly string[] = [
    '/v',
    '/v/notes',
    '/v/notes/work',
    '/v/notes/work/2024',
    '/v/notes/work/2025',
    '/v/notes/archive',
    '/v/notes/archive/2023',
    '/v/work',
    '/v/work/proj1',
    '/v/work/proj2',
    '/v/disjoint',
    '/v/disjoint/x',
    '/other-vault',
    '/other-vault/x',
    '/other-vault/x/y',
]

/**
 * Generate a canonical legacy snapshot:
 *   - readPaths === loadedRoots, AND
 *   - collapseSet ∩ readPaths = ∅ after normalisation.
 * Round-trip identity is provable on canonical inputs.
 */
function genCanonicalLegacy(rng: () => number): LegacyVisibilitySnapshot {
    const watched = new Set<string>()
    for (const p of PATH_POOL) {
        if (rng() < 0.4) watched.add(p)
    }
    const collapsed = new Set<string>()
    for (const p of PATH_POOL) {
        if (watched.has(p)) continue           // disjoint from watched
        if (rng() < 0.25) collapsed.add(ensureTrailingSlash(p))
    }
    return {
        readPaths: watched,
        loadedRoots: new Set(watched),
        collapseSet: collapsed,
    }
}

/**
 * Canonicalise an arbitrary (possibly non-canonical) legacy snapshot to the
 * shape the inverse projection emits:
 *   - readPaths == loadedRoots == (orig.readPaths ∪ orig.loadedRoots) \ collapsedNorm
 *   - collapseSet untouched (collapsed-overrides-expand wins)
 */
function canonicaliseLegacy(legacy: LegacyVisibilitySnapshot): LegacyVisibilitySnapshot {
    const collapseNorm = new Set([...legacy.collapseSet].map(stripTrailingSlash))
    const watched = new Set<string>()
    for (const p of legacy.readPaths) {
        const norm = stripTrailingSlash(p)
        if (!collapseNorm.has(norm)) watched.add(norm)
    }
    for (const p of legacy.loadedRoots) {
        const norm = stripTrailingSlash(p)
        if (!collapseNorm.has(norm)) watched.add(norm)
    }
    const collapsed = new Set<string>()
    for (const f of legacy.collapseSet) collapsed.add(ensureTrailingSlash(f))
    return {
        readPaths: watched,
        loadedRoots: new Set(watched),
        collapseSet: collapsed,
    }
}

function assertSetEqual<T>(a: ReadonlySet<T>, b: ReadonlySet<T>, ctx: string): void {
    expect(a.size, `[${ctx}] size mismatch`).toBe(b.size)
    for (const x of a) {
        expect(b.has(x), `[${ctx}] missing element ${String(x)} in second set`).toBe(true)
    }
}

function assertLegacyEqual(
    a: LegacyVisibilitySnapshot,
    b: LegacyVisibilitySnapshot,
    ctx: string,
): void {
    assertSetEqual(a.readPaths, b.readPaths, `${ctx} readPaths`)
    assertSetEqual(a.loadedRoots, b.loadedRoots, `${ctx} loadedRoots`)
    assertSetEqual(a.collapseSet, b.collapseSet, `${ctx} collapseSet`)
}

// ============================================================================
// Seed cases (verbatim from BF-236 spec)
// ============================================================================

describe('folderVisibility derivation — required seed cases', () => {
    it('seed 1: empty state derives to empty map', () => {
        const legacy: LegacyVisibilitySnapshot = {
            readPaths: new Set(),
            loadedRoots: new Set(),
            collapseSet: new Set(),
        }
        const map = deriveFolderVisibilityFromLegacy(legacy)
        expect(map.size).toBe(0)
        const roundtrip = deriveLegacyFromFolderVisibility(map)
        assertLegacyEqual(roundtrip, legacy, 'seed-1')
    })

    it('seed 2: single read-path becomes one expanded row', () => {
        const legacy: LegacyVisibilitySnapshot = {
            readPaths: new Set(['/v/notes']),
            loadedRoots: new Set(['/v/notes']),
            collapseSet: new Set(),
        }
        const map = deriveFolderVisibilityFromLegacy(legacy)
        expect(map.size).toBe(1)
        expect(map.get('/v/notes')).toBe('expanded')
        const roundtrip = deriveLegacyFromFolderVisibility(map)
        assertLegacyEqual(roundtrip, legacy, 'seed-2')
    })

    it('seed 3: single collapse under expanded parent', () => {
        const legacy: LegacyVisibilitySnapshot = {
            readPaths: new Set(['/v']),
            loadedRoots: new Set(['/v']),
            collapseSet: new Set(['/v/notes/']),
        }
        const map = deriveFolderVisibilityFromLegacy(legacy)
        expect(map.get('/v')).toBe('expanded')
        expect(map.get('/v/notes')).toBe('collapsed')
        const roundtrip = deriveLegacyFromFolderVisibility(map)
        assertLegacyEqual(roundtrip, legacy, 'seed-3')
    })

    it('seed 4: disjoint roots both render expanded', () => {
        const legacy: LegacyVisibilitySnapshot = {
            readPaths: new Set(['/v/notes', '/other-vault']),
            loadedRoots: new Set(['/v/notes', '/other-vault']),
            collapseSet: new Set(),
        }
        const map = deriveFolderVisibilityFromLegacy(legacy)
        expect(map.get('/v/notes')).toBe('expanded')
        expect(map.get('/other-vault')).toBe('expanded')
        // implicit roots = both, since neither's parent is non-hidden
        const roots = deriveImplicitRoots(map)
        assertSetEqual(roots, new Set(['/v/notes', '/other-vault']), 'seed-4 roots')
        const roundtrip = deriveLegacyFromFolderVisibility(map)
        assertLegacyEqual(roundtrip, legacy, 'seed-4')
    })

    it('seed 5: deep collapse-under-expand chain', () => {
        const legacy: LegacyVisibilitySnapshot = {
            readPaths: new Set(['/v', '/v/notes', '/v/notes/work']),
            loadedRoots: new Set(['/v', '/v/notes', '/v/notes/work']),
            collapseSet: new Set(['/v/notes/work/2024/']),
        }
        const map = deriveFolderVisibilityFromLegacy(legacy)
        expect(map.get('/v')).toBe('expanded')
        expect(map.get('/v/notes')).toBe('expanded')
        expect(map.get('/v/notes/work')).toBe('expanded')
        expect(map.get('/v/notes/work/2024')).toBe('collapsed')
        // Watch roots = topmost expanded only (Decision 3 / spec scenario)
        const watch = deriveWatchRoots(map)
        assertSetEqual(watch, new Set(['/v']), 'seed-5 watch')
        const roundtrip = deriveLegacyFromFolderVisibility(map)
        assertLegacyEqual(roundtrip, legacy, 'seed-5')
    })

    it('seed 6: collapse overrides expand when folder appears in both', () => {
        const legacy: LegacyVisibilitySnapshot = {
            readPaths: new Set(['/v/notes']),
            loadedRoots: new Set(['/v/notes']),
            collapseSet: new Set(['/v/notes/']),
        }
        const map = deriveFolderVisibilityFromLegacy(legacy)
        // collapsed wins — only one row, state='collapsed'.
        expect(map.size).toBe(1)
        expect(map.get('/v/notes')).toBe('collapsed')
        // Round-trip to canonical form: readPaths/loadedRoots drop /v/notes,
        // collapseSet keeps it (collapse-overrides-expand normalisation).
        const roundtrip = deriveLegacyFromFolderVisibility(map)
        assertLegacyEqual(roundtrip, canonicaliseLegacy(legacy), 'seed-6')
    })
})

// ============================================================================
// Round-trip property — randomised
// ============================================================================

describe('folderVisibility derivation — round-trip property (canonical inputs)', () => {
    it('inverse(forward(legacy)) === legacy for canonical snapshots, 200 runs', () => {
        const SEED = 0xCAFEF00D
        const RUNS = 200
        const topRng = mulberry32(SEED)

        for (let r = 0; r < RUNS; r++) {
            const seqSeed = (topRng() * 0xFFFFFFFF) >>> 0
            const seqRng = mulberry32(seqSeed)
            const legacy = genCanonicalLegacy(seqRng)
            const forward = deriveFolderVisibilityFromLegacy(legacy)
            const back = deriveLegacyFromFolderVisibility(forward)
            const ctx = `run=${r} seed=0x${seqSeed.toString(16)}`
            assertLegacyEqual(back, legacy, ctx)
        }
    })

    it('forward(inverse(map)) === map for any FolderVisibilityState (idempotency on the unified side)', () => {
        const SEED = 0xBADDCAFE
        const RUNS = 200
        const topRng = mulberry32(SEED)

        for (let r = 0; r < RUNS; r++) {
            const seqSeed = (topRng() * 0xFFFFFFFF) >>> 0
            const seqRng = mulberry32(seqSeed)
            const legacy = genCanonicalLegacy(seqRng)
            const m1 = deriveFolderVisibilityFromLegacy(legacy)
            const back = deriveLegacyFromFolderVisibility(m1)
            const m2 = deriveFolderVisibilityFromLegacy(back)
            const ctx = `run=${r} seed=0x${seqSeed.toString(16)}`
            expect(m2.size, ctx).toBe(m1.size)
            for (const [k, v] of m1) {
                expect(m2.get(k), `${ctx} key=${k}`).toBe(v)
            }
        }
    })
})

// ============================================================================
// Implicit roots / watch roots — spec scenarios
// ============================================================================

describe('folderVisibility — implicit roots & watch roots', () => {
    it('implicitRoots returns non-hidden folders whose parent is hidden', () => {
        const map: FolderVisibilityState = new Map<string, 'expanded' | 'collapsed' | 'hidden'>([
            ['/v', 'expanded'],
            ['/v/notes', 'expanded'],
            ['/other', 'collapsed'],
            ['/other/x', 'expanded'],          // parent /other is collapsed (non-hidden) → NOT a root
        ])
        const roots = deriveImplicitRoots(map)
        assertSetEqual(roots, new Set(['/v', '/other']), 'implicitRoots-basic')
    })

    it('implicitRoots: collapsed orphan with hidden parent IS a root (Decision 1: lookup-time)', () => {
        const map: FolderVisibilityState = new Map<string, 'expanded' | 'collapsed' | 'hidden'>([
            ['/v/orphan', 'collapsed'],        // /v has no row → hidden; orphan still a root
        ])
        const roots = deriveImplicitRoots(map)
        assertSetEqual(roots, new Set(['/v/orphan']), 'implicitRoots-orphan')
    })

    it('watchRoots returns topmost expanded only', () => {
        const map: FolderVisibilityState = new Map<string, 'expanded' | 'collapsed' | 'hidden'>([
            ['/v', 'expanded'],
            ['/v/notes', 'expanded'],          // covered by /v
            ['/v/notes/work', 'expanded'],     // covered by /v
            ['/other', 'expanded'],
        ])
        const watch = deriveWatchRoots(map)
        assertSetEqual(watch, new Set(['/v', '/other']), 'watchRoots-topmost')
    })

    it('watchRoots ignores collapsed and hidden', () => {
        const map: FolderVisibilityState = new Map<string, 'expanded' | 'collapsed' | 'hidden'>([
            ['/v', 'collapsed'],
            ['/v/notes', 'hidden'],
            ['/other', 'expanded'],
        ])
        const watch = deriveWatchRoots(map)
        assertSetEqual(watch, new Set(['/other']), 'watchRoots-non-expanded')
    })
})
