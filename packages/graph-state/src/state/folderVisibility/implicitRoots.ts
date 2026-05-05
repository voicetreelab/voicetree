import type {
    AbsolutePath,
    FolderState,
    FolderVisibilityState,
} from './types'

/** Posix parent of an absolute path; `null` at filesystem root or for an empty path. */
function pathParent(p: AbsolutePath): AbsolutePath | null {
    if (p === '' || p === '/') return null
    const stripped = p.endsWith('/') ? p.slice(0, -1) : p
    const lastSlash = stripped.lastIndexOf('/')
    if (lastSlash < 0) return null   // no separator
    if (lastSlash === 0) return '/'  // parent of '/foo' is '/'
    return stripped.slice(0, lastSlash)
}

/** Folder's own row state, defaulting to 'hidden' when absent (Decision 1). */
function ownState(map: FolderVisibilityState, p: AbsolutePath): FolderState {
    return map.get(p) ?? 'hidden'
}

/**
 * Implicit roots = `{ p | own(p) ≠ 'hidden' ∧ own(parent(p)) === 'hidden' }`.
 *
 * Replaces the explicitly-stored `roots.loaded` set in the unified model
 * (Decision 3). Pure function over the rows in `map`.
 */
export function deriveImplicitRoots(map: FolderVisibilityState): Set<AbsolutePath> {
    const result = new Set<AbsolutePath>()
    for (const [path, state] of map) {
        if (state === 'hidden') continue
        const parent = pathParent(path)
        const parentState: FolderState = parent === null ? 'hidden' : ownState(map, parent)
        if (parentState === 'hidden') result.add(path)
    }
    return result
}

/**
 * Watch roots = topmost paths with own='expanded' (no expanded ancestor).
 *
 * Replaces the explicit chokidar mount set; in Phase 1+ the watcher consumes
 * this directly. A nested expanded folder under an already-expanded ancestor
 * is NOT a separate watch root (the ancestor's mount already covers it).
 */
export function deriveWatchRoots(map: FolderVisibilityState): Set<AbsolutePath> {
    const result = new Set<AbsolutePath>()
    for (const [path, state] of map) {
        if (state !== 'expanded') continue
        let hasExpandedAncestor = false
        let current = pathParent(path)
        while (current !== null) {
            if (ownState(map, current) === 'expanded') {
                hasExpandedAncestor = true
                break
            }
            current = pathParent(current)
        }
        if (!hasExpandedAncestor) result.add(path)
    }
    return result
}
