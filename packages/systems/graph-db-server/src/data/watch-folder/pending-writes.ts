import path from 'path'

const PENDING_WRITE_TTL_MS = 5000

type PendingKind = 'write' | 'delete'
type EditorId = string

interface PendingEntry {
    count: number
    readonly timers: Set<ReturnType<typeof setTimeout>>
    readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void
    readonly suppressBroadcastTo: Set<EditorId>
}

interface PendingTimerDependencies {
    readonly setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
    readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void
}

const defaultPendingTimerDependencies: PendingTimerDependencies = {
    setTimer(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
        return setTimeout(callback, delayMs)
    },
    clearTimer(timer: ReturnType<typeof setTimeout>): void {
        clearTimeout(timer)
    },
}

const pendingWrites: Map<string, PendingEntry> = new Map()
const pendingDeletes: Map<string, PendingEntry> = new Map()

function normalizePath(absolutePath: string): string {
    return path.resolve(absolutePath)
}

function getPendingMap(kind: PendingKind): Map<string, PendingEntry> {
    return kind === 'write' ? pendingWrites : pendingDeletes
}

function incrementPending(
    kind: PendingKind,
    absolutePath: string,
    opts: { suppressBroadcastTo?: EditorId } = {},
    dependencies: PendingTimerDependencies = defaultPendingTimerDependencies,
): void {
    const pendingMap: Map<string, PendingEntry> = getPendingMap(kind)
    const normalizedPath: string = normalizePath(absolutePath)
    const entry: PendingEntry = pendingMap.get(normalizedPath) ?? {
        count: 0,
        timers: new Set(),
        clearTimer: dependencies.clearTimer,
        suppressBroadcastTo: new Set(),
    }

    const timer: ReturnType<typeof setTimeout> = dependencies.setTimer(() => {
        entry.timers.delete(timer)
        decrementPending(kind, normalizedPath)
    }, PENDING_WRITE_TTL_MS)

    if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref()
    }

    entry.count += 1
    if (kind === 'write' && opts.suppressBroadcastTo) {
        entry.suppressBroadcastTo.add(opts.suppressBroadcastTo)
    }
    entry.timers.add(timer)
    pendingMap.set(normalizedPath, entry)
}

function decrementPending(kind: PendingKind, absolutePath: string): void {
    const pendingMap: Map<string, PendingEntry> = getPendingMap(kind)
    const normalizedPath: string = normalizePath(absolutePath)
    const entry: PendingEntry | undefined = pendingMap.get(normalizedPath)

    if (!entry) {
        return
    }

    entry.count -= 1
    if (entry.count <= 0) {
        for (const timer of entry.timers) {
            entry.clearTimer(timer)
        }
        pendingMap.delete(normalizedPath)
    }
}

export function markPendingWrite(
    absolutePath: string,
    opts: { suppressBroadcastTo?: EditorId } = {},
): void {
    incrementPending('write', absolutePath, opts)
}

export function markPendingDelete(absolutePath: string): void {
    incrementPending('delete', absolutePath)
}

export function isPendingWrite(absolutePath: string): boolean {
    const normalizedPath: string = normalizePath(absolutePath)
    return (pendingWrites.get(normalizedPath)?.count ?? 0) > 0
        || (pendingDeletes.get(normalizedPath)?.count ?? 0) > 0
}

export function clearPendingWrite(absolutePath: string): void {
    const normalizedPath: string = normalizePath(absolutePath)

    if ((pendingWrites.get(normalizedPath)?.count ?? 0) > 0) {
        decrementPending('write', normalizedPath)
        return
    }

    decrementPending('delete', normalizedPath)
}

export function consumeBroadcastSuppression(absolutePath: string): ReadonlySet<EditorId> {
    const normalizedPath: string = normalizePath(absolutePath)
    const entry: PendingEntry | undefined = pendingWrites.get(normalizedPath)
    if (!entry) {
        return new Set()
    }

    const suppression: ReadonlySet<EditorId> = new Set(entry.suppressBroadcastTo)
    decrementPending('write', normalizedPath)
    return suppression
}
