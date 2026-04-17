/**
 * Singleton store for graph-level folder collapse state.
 *
 * Single source of truth for collapseSet, mirroring the role of
 * state.collapseSet in the full graph-state contract (contract.d.ts:69).
 *
 * Renderer-safe: no Node.js deps. Collapse/Expand logic is inlined
 * (identical to applyCollapse/applyExpand in applyCommand.ts) to avoid
 * pulling roots.ts (disk I/O) into the renderer bundle.
 *
 * Follows the same module-level singleton pattern as
 * graph-model/src/state/recent-deltas-store.ts.
 */

import type { FolderId } from '../contract'

type CollapseSetCallback = (set: ReadonlySet<FolderId>) => void

let collapseSet: ReadonlySet<FolderId> = new Set()
const subscribers: Set<CollapseSetCallback> = new Set()

function notify(): void {
    for (const cb of subscribers) {
        cb(collapseSet)
    }
}

export function getCollapseSet(): ReadonlySet<FolderId> {
    return collapseSet
}

/** Adds folder to collapseSet. No-op if already collapsed; no notification fired. */
export function dispatchCollapse(folder: FolderId): void {
    if (!collapseSet.has(folder)) {
        collapseSet = new Set([...collapseSet, folder])
        notify()
    }
}

/** Removes folder from collapseSet. No-op if not collapsed; no notification fired. */
export function dispatchExpand(folder: FolderId): void {
    if (collapseSet.has(folder)) {
        collapseSet = new Set([...collapseSet].filter((id) => id !== folder))
        notify()
    }
}

/** Subscribe to collapseSet changes. Returns an unsubscribe function. */
export function subscribeCollapseSet(cb: CollapseSetCallback): () => void {
    subscribers.add(cb)
    return () => {
        subscribers.delete(cb)
    }
}

/** Clear all state (for testing only). */
export function clearCollapseSet(): void {
    collapseSet = new Set()
    subscribers.clear()
}
