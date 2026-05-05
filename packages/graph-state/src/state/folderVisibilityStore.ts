import type { State } from '../contract'
import { deriveFolderVisibilityFromLegacy } from './folderVisibility/derive'
import type {
    FolderVisibilityState,
    LegacyVisibilitySnapshot,
} from './folderVisibility/types'

/**
 * BF-236 Phase 0 — read-only selector returning the unified folder-visibility
 * map for a given State snapshot.
 *
 * Phase 0 has no setters and no separate sqlite store; the map is derived
 * fresh from the snapshot's legacy fields (`roots.loaded` and `collapseSet`)
 * on every call. Phase 1 (BF-238) flips authority by introducing the sqlite
 * primary store and re-implementing `loadedRootsStore`/`collapseSetStore` as
 * derived selectors.
 *
 * Phase 1 consumers depend on this selector — they will be unaffected by the
 * storage flip in Phase 1 because the signature stays stable.
 *
 * Note: graph-state's `State` has no `readPaths` field — in the legacy split,
 * `readPaths` lives in vault config (graph-model). For derivation purposes
 * `roots.loaded` plays both roles (watched + loaded); fuzzing covers cases
 * where the two diverge.
 */
export function getFolderVisibility(state: State): FolderVisibilityState {
    const legacy: LegacyVisibilitySnapshot = {
        readPaths: state.roots.loaded,
        loadedRoots: state.roots.loaded,
        collapseSet: state.collapseSet,
    }
    return deriveFolderVisibilityFromLegacy(legacy)
}
