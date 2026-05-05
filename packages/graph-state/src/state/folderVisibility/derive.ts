import type {
    AbsolutePath,
    FolderState,
    FolderVisibilityState,
    LegacyVisibilitySnapshot,
} from './types'

/** Strip a trailing '/' from a path, preserving the filesystem root '/'. */
export function stripTrailingSlash(p: string): AbsolutePath {
    if (p === '' || p === '/') return p
    return p.endsWith('/') ? p.slice(0, -1) : p
}

/** Add a trailing '/' to a path, idempotent. */
export function ensureTrailingSlash(p: string): string {
    return p.endsWith('/') ? p : `${p}/`
}

/**
 * Forward derivation: legacy `{readPaths, loadedRoots, collapseSet}` ->
 * unified per-folder map.
 *
 * Rules (Decision 1, lookup-time, no cascade):
 *   - Folders in `readPaths ∪ loadedRoots`  -> 'expanded'.
 *   - Folders in `collapseSet`              -> 'collapsed' (overrides expanded
 *                                              if also in readPaths/loadedRoots).
 *   - Otherwise                             -> no row (= 'hidden' default).
 *
 * Orphan-collapse handling: a `collapseSet` entry whose ancestor chain has no
 * `readPaths`/`loadedRoots` member is preserved as a 'collapsed' row. Per
 * Decision 1, lookup-time visibility rules — not derivation — handle the
 * "rendered under hidden parent" case. Keeping the row makes the projection
 * information-preserving and round-trippable.
 */
export function deriveFolderVisibilityFromLegacy(
    legacy: LegacyVisibilitySnapshot,
): Map<AbsolutePath, FolderState> {
    const map = new Map<AbsolutePath, FolderState>()

    // 1. 'expanded' for the union of readPaths and loadedRoots.
    for (const p of legacy.readPaths) map.set(stripTrailingSlash(p), 'expanded')
    for (const p of legacy.loadedRoots) map.set(stripTrailingSlash(p), 'expanded')

    // 2. 'collapsed' overrides 'expanded' for any path also in collapseSet.
    for (const f of legacy.collapseSet) map.set(stripTrailingSlash(f), 'collapsed')

    return map
}

/**
 * Inverse projection: unified map -> legacy `{readPaths, loadedRoots, collapseSet}`.
 *
 * Round-trip identity holds for canonical legacy snapshots:
 *   - `readPaths === loadedRoots` (single watched-set in the legacy model), AND
 *   - `collapseSet ∩ readPaths = ∅` after path normalization (a folder is
 *     either watched-expanded or collapsed, not both).
 *
 * Non-canonical inputs lose the asymmetry on round-trip (canonicalised); the
 * fuzz tests generate canonical inputs so identity is provable.
 */
export function deriveLegacyFromFolderVisibility(
    map: FolderVisibilityState,
): {
    readPaths: Set<AbsolutePath>
    loadedRoots: Set<AbsolutePath>
    collapseSet: Set<string>
} {
    const readPaths = new Set<AbsolutePath>()
    const loadedRoots = new Set<AbsolutePath>()
    const collapseSet = new Set<string>()
    for (const [path, state] of map) {
        if (state === 'expanded') {
            readPaths.add(path)
            loadedRoots.add(path)
        } else if (state === 'collapsed') {
            collapseSet.add(ensureTrailingSlash(path))
        }
        // 'hidden' is the default; no row.
    }
    return { readPaths, loadedRoots, collapseSet }
}
