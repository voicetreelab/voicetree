/**
 * Phase 1 legacy shim: no-arg callers keep the existing singleton behavior,
 * while view-aware callers derive collapsed folders from folderVisibilityStore.
 */
import type { FolderId } from '../contract'
import { deriveLegacyFromFolderVisibility, stripTrailingSlash } from './folderVisibility/derive'
import { getFolderVisibility, setFolderState } from './folderVisibilityStore'
import type { FolderState } from './folderVisibility/types'

const DEFAULT_VIEW_ID = 'main'

type CollapseSetCallback = (set: ReadonlySet<FolderId>) => void

let collapseSet: Set<FolderId> = new Set()
const subscribers: Set<CollapseSetCallback> = new Set()

function notify(): void {
    for (const cb of subscribers) {
        cb(collapseSet)
    }
}

function collapseInto(
    target: Set<FolderId>,
    folder: FolderId,
): Set<FolderId> {
    if (target.has(folder)) {
        return target
    }
    return new Set([...target, folder])
}

function expandFrom(
    target: Set<FolderId>,
    folder: FolderId,
): Set<FolderId> {
    if (!target.has(folder)) {
        return target
    }
    return new Set([...target].filter((id) => id !== folder))
}

export function getCollapseSet(viewId?: string): ReadonlySet<FolderId> {
    if (viewId !== undefined) {
        return deriveLegacyFromFolderVisibility(getFolderVisibility(viewId)).collapseSet
    }
    return collapseSet
}

/** Adds folder to collapseSet. No-op if already collapsed; no notification fired. */
export function dispatchCollapse(folder: FolderId): void
export function dispatchCollapse(
    target: Set<FolderId>,
    folder: FolderId,
): Set<FolderId>
export function dispatchCollapse(
    folderOrTarget: FolderId | Set<FolderId>,
    maybeFolder?: FolderId,
): void | Set<FolderId> {
    if (folderOrTarget instanceof Set) {
        return collapseInto(folderOrTarget, maybeFolder as FolderId)
    }

    writeFolderState(folderOrTarget, 'collapsed')
    const next = collapseInto(collapseSet, folderOrTarget)
    if (next !== collapseSet) {
        collapseSet = next
        notify()
    }
}

/** Removes folder from collapseSet. No-op if not collapsed; no notification fired. */
export function dispatchExpand(folder: FolderId): void
export function dispatchExpand(
    target: Set<FolderId>,
    folder: FolderId,
): Set<FolderId>
export function dispatchExpand(
    folderOrTarget: FolderId | Set<FolderId>,
    maybeFolder?: FolderId,
): void | Set<FolderId> {
    if (folderOrTarget instanceof Set) {
        return expandFrom(folderOrTarget, maybeFolder as FolderId)
    }

    writeFolderState(folderOrTarget, 'expanded')
    const next = expandFrom(collapseSet, folderOrTarget)
    if (next !== collapseSet) {
        collapseSet = next
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

function writeFolderState(folder: FolderId, state: FolderState): void {
    try {
        setFolderState(DEFAULT_VIEW_ID, stripTrailingSlash(folder), state)
    } catch (error) {
        if (!isUnconfiguredStoreError(error)) {
            throw error
        }
    }
}

function isUnconfiguredStoreError(error: unknown): boolean {
    return error instanceof Error
        && error.message === 'folderVisibilityStore is not configured with a sqlite database'
}
