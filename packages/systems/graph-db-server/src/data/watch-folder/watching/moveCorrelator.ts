/**
 * Move correlator — a bounded, basename-keyed TTL buffer that lets the watcher
 * pair an `unlink` with the `add` that completes a filesystem move, in either
 * arrival order, without depending on event ordering.
 *
 * It is the ONLY stateful piece of move detection and is confined to the impure
 * watcher shell. It holds no domain logic: it buffers `unlink` identities and
 * dropped-`add` paths keyed by basename, and the watcher decides what matches
 * (via the pure `identitiesMatch`). To consume a matched entry the caller passes
 * back the exact reference it read, so the buffer never compares identities
 * itself.
 *
 * Lifecycle: every recorded entry expires after `windowMs` (its own timer). An
 * entry that never finds its counterpart simply expires and is discarded — the
 * `unlink`'s delete already applied, so there is nothing to undo. `dispose()`
 * clears every outstanding timer so nothing fires after the watcher unmounts.
 */

import type { MoveIdentity } from './moveIdentity.ts'

export interface MoveCorrelator {
    /** Buffer the identity of an unlinked loaded node, for a later matching add. */
    recordUnlink(basename: string, identity: MoveIdentity): void
    /** Buffer the path of an add that was gated out, for a later matching unlink. */
    recordDroppedAdd(basename: string, filePath: string): void
    /** Identities of currently-buffered unlinks for this basename (by reference). */
    pendingUnlinkIdentities(basename: string): readonly MoveIdentity[]
    /** Paths of currently-buffered dropped adds for this basename. */
    pendingDroppedAddPaths(basename: string): readonly string[]
    /** Remove the buffered unlink whose identity === the passed reference. */
    consumeUnlink(basename: string, identity: MoveIdentity): void
    /** Remove the buffered dropped add for the given path. */
    consumeDroppedAdd(basename: string, filePath: string): void
    /** Clear all entries and their timers. Call on watcher unmount. */
    dispose(): void
}

const DEFAULT_WINDOW_MS = 2000

interface UnlinkEntry {
    readonly identity: MoveIdentity
    readonly timer: ReturnType<typeof setTimeout>
}

interface AddEntry {
    readonly filePath: string
    readonly timer: ReturnType<typeof setTimeout>
}

export function createMoveCorrelator(opts: { windowMs?: number } = {}): MoveCorrelator {
    const windowMs: number = opts.windowMs ?? DEFAULT_WINDOW_MS
    const unlinks = new Map<string, UnlinkEntry[]>()
    const droppedAdds = new Map<string, AddEntry[]>()

    function dropEntry<T extends { timer: ReturnType<typeof setTimeout> }>(
        map: Map<string, T[]>,
        basename: string,
        predicate: (entry: T) => boolean,
    ): void {
        const entries: T[] | undefined = map.get(basename)
        if (entries === undefined) return
        const index: number = entries.findIndex(predicate)
        if (index === -1) return
        clearTimeout(entries[index].timer)
        entries.splice(index, 1)
        if (entries.length === 0) map.delete(basename)
    }

    function appendEntry<T extends { timer: ReturnType<typeof setTimeout> }>(
        map: Map<string, T[]>,
        basename: string,
        makeEntry: (timer: ReturnType<typeof setTimeout>) => T,
        expire: () => void,
    ): void {
        const timer: ReturnType<typeof setTimeout> = setTimeout(expire, windowMs)
        // Don't let a pending move window keep the process alive.
        timer.unref?.()
        const entry: T = makeEntry(timer)
        const existing: T[] | undefined = map.get(basename)
        if (existing === undefined) map.set(basename, [entry])
        else existing.push(entry)
    }

    return {
        recordUnlink(basename: string, identity: MoveIdentity): void {
            appendEntry<UnlinkEntry>(
                unlinks,
                basename,
                (timer) => ({ identity, timer }),
                () => dropEntry(unlinks, basename, (e) => e.identity === identity),
            )
        },

        recordDroppedAdd(basename: string, filePath: string): void {
            appendEntry<AddEntry>(
                droppedAdds,
                basename,
                (timer) => ({ filePath, timer }),
                () => dropEntry(droppedAdds, basename, (e) => e.filePath === filePath),
            )
        },

        pendingUnlinkIdentities(basename: string): readonly MoveIdentity[] {
            return (unlinks.get(basename) ?? []).map((e) => e.identity)
        },

        pendingDroppedAddPaths(basename: string): readonly string[] {
            return (droppedAdds.get(basename) ?? []).map((e) => e.filePath)
        },

        consumeUnlink(basename: string, identity: MoveIdentity): void {
            dropEntry(unlinks, basename, (e) => e.identity === identity)
        },

        consumeDroppedAdd(basename: string, filePath: string): void {
            dropEntry(droppedAdds, basename, (e) => e.filePath === filePath)
        },

        dispose(): void {
            for (const entries of unlinks.values()) for (const e of entries) clearTimeout(e.timer)
            for (const entries of droppedAdds.values()) for (const e of entries) clearTimeout(e.timer)
            unlinks.clear()
            droppedAdds.clear()
        },
    }
}
