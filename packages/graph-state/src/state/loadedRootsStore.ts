/**
 * Singleton store for loaded-roots state.
 *
 * Single source of truth for which vault/folder roots are loaded, mirroring
 * state.roots.loaded in the full graph-state contract (contract.d.ts:56-60).
 *
 * Holds a full internal State so that LoadRoot (async, disk I/O) and
 * UnloadRoot (sync, removes all nodes under the root) can use the existing
 * applyLoadRoot / applyCommandWithDelta reducers without duplication.
 *
 * The subscriber delta includes `graph` so callers (e.g. clearCytoscapeState)
 * can project the DeleteNode operations onto cytoscape without inferring root
 * identity from cy state (V-L2-3).
 *
 * Follows the module-level singleton pattern of collapseSetStore.ts.
 */

import type { Delta, RootPath, State, Unsubscribe } from '../contract'
import { emptyState } from '../emptyState'
import { applyCommandWithDelta } from '../applyCommand'
import { applyLoadRoot } from '../apply/roots'

export type RootsDelta = Pick<Delta, 'rootsLoaded' | 'rootsUnloaded' | 'graph'>
export type LoadedRootsSubscriber = (delta: RootsDelta) => void

let state: State = emptyState()
const subscribers: Set<LoadedRootsSubscriber> = new Set()

function notify(delta: RootsDelta): void {
    for (const cb of subscribers) {
        cb(delta)
    }
}

export function getLoadedRoots(): ReadonlySet<RootPath> {
    return state.roots.loaded
}

export function isRootLoaded(root: RootPath): boolean {
    return state.roots.loaded.has(root)
}

/**
 * Load a root from disk and add it to the loaded set.
 * Async (reads files from disk). No-op if already loaded.
 */
export async function dispatchLoadRoot(root: RootPath): Promise<void> {
    const result = await applyLoadRoot(state, { type: 'LoadRoot', root })
    state = result.state
    const { delta } = result
    if (delta.rootsLoaded && delta.rootsLoaded.length > 0) {
        notify({
            rootsLoaded: delta.rootsLoaded,
            ...(delta.graph ? { graph: delta.graph } : {}),
        })
    }
}

/**
 * Unload a root, removing all its nodes from state.
 * Sync. No-op if root is not loaded.
 */
export function dispatchUnloadRoot(root: RootPath): void {
    const { state: next, delta } = applyCommandWithDelta(state, { type: 'UnloadRoot', root })
    state = next
    if (delta.rootsUnloaded && delta.rootsUnloaded.length > 0) {
        notify({
            rootsUnloaded: delta.rootsUnloaded,
            ...(delta.graph ? { graph: delta.graph } : {}),
        })
    }
}

/** Subscribe to root-load/unload events. Returns an unsubscribe function. */
export function subscribeLoadedRoots(cb: LoadedRootsSubscriber): Unsubscribe {
    subscribers.add(cb)
    return () => { subscribers.delete(cb) }
}

/** Reset all state and subscribers (for testing only). */
export function clearLoadedRoots(): void {
    state = emptyState()
    subscribers.clear()
}
