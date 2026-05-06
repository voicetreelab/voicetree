import path from 'path'

const PENDING_WRITE_TTL_MS = 5000

type PendingKind = 'write' | 'delete'

interface PendingEntry {
    count: number
    readonly timers: Set<ReturnType<typeof setTimeout>>
}

const pendingWrites: Map<string, PendingEntry> = new Map()
const pendingDeletes: Map<string, PendingEntry> = new Map()

function normalizePath(absolutePath: string): string {
    return path.resolve(absolutePath)
}

function getPendingMap(kind: PendingKind): Map<string, PendingEntry> {
    return kind === 'write' ? pendingWrites : pendingDeletes
}

function incrementPending(kind: PendingKind, absolutePath: string): void {
    const pendingMap: Map<string, PendingEntry> = getPendingMap(kind)
    const normalizedPath: string = normalizePath(absolutePath)
    const entry: PendingEntry = pendingMap.get(normalizedPath) ?? {
        count: 0,
        timers: new Set(),
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        entry.timers.delete(timer)
        decrementPending(kind, normalizedPath)
    }, PENDING_WRITE_TTL_MS)

    if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref()
    }

    entry.count += 1
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
            clearTimeout(timer)
        }
        pendingMap.delete(normalizedPath)
    }
}

export function markPendingWrite(absolutePath: string): void {
    incrementPending('write', absolutePath)
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
