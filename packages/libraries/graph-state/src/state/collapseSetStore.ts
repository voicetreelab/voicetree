import type { FolderId } from '../contract'
import { setFolderState } from './folderVisibilityStore'
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

export function getCollapseSet(): ReadonlySet<FolderId> {
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
        setFolderState(DEFAULT_VIEW_ID, stripFolderIdTrailingSlash(folder), state)
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

function stripFolderIdTrailingSlash(folder: FolderId): string {
    return folder === '/' ? folder : folder.slice(0, -1)
}
