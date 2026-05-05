/**
 * Phase 1 legacy shim: no-arg callers keep the existing singleton behavior,
 * while view-aware callers derive loaded roots from folderVisibilityStore.
 */
import type { Delta, RootPath, State, Unsubscribe } from '../contract'
import { emptyState } from '../emptyState'
import { applyCommandWithDelta } from '../applyCommand'
import { applyLoadRoot } from '../apply/roots'
import { deriveImplicitRoots } from './folderVisibility/implicitRoots'
import { getFolderVisibility } from './folderVisibilityStore'

export type RootsDelta = Pick<Delta, 'rootsLoaded' | 'rootsUnloaded' | 'graph'>
export type LoadedRootsSubscriber = (delta: RootsDelta) => void

let state: State = emptyState()
const subscribers: Set<LoadedRootsSubscriber> = new Set()

function notify(delta: RootsDelta): void {
    for (const cb of subscribers) {
        cb(delta)
    }
}

export function getLoadedRoots(viewId?: string): ReadonlySet<RootPath> {
    if (viewId !== undefined) {
        return deriveImplicitRoots(getFolderVisibility(viewId))
    }
    return state.roots.loaded
}

export function isRootLoaded(root: RootPath, viewId?: string): boolean {
    return getLoadedRoots(viewId).has(root)
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
