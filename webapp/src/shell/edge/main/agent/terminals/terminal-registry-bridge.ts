/**
 * Local cache mirror of the per-project VTD's terminal registry, driven by
 * `terminal-registry` SSE deltas.
 *
 * Backs `getTerminalRecords` cold-start + live deltas for Stage 3
 * webapp callers. The cache is mutated by `applyTerminalRegistryEnvelope`
 * (which receives the envelopes the SSE subscriber forwards after the
 * project-switch fence) and read by `getCachedTerminalRecords` /
 * `getCachedTerminalRecord`.
 *
 * Three of the five `TerminalRegistryEvent` shapes mutate the cache:
 *   - `terminal-registered`       → set(record.terminalId, record)
 *   - `terminal-removed`          → delete(terminalId)
 *   - `terminal-record-changed`   → patch the existing record in place
 *                                   per `patch.kind` discriminator
 *
 * The two UI-imperative events (`terminal-ui-launch`,
 * `terminal-ui-child-registered`) are not registry mutations — they
 * carry instructions the renderer acts on. This bridge forwards them
 * through `applyTerminalRegistryEnvelope`'s return value so a caller
 * (the openProject wiring) can fan them out to the renderer without each
 * receiver re-parsing the envelope.
 *
 * Project-switch semantics: the cache survives across project switches by
 * design — the SSE subscriber resets its `lastSeenSeq` on swap, and the
 * Stage-3 cold-start path will call `resetCache` + `getTerminalRecords`
 * RPC to fill the mirror fresh. For now this module exports
 * `resetTerminalRegistryCache` so project-switch wiring (and tests) can
 * clear it explicitly.
 *
 * NOTE (closure invariant): the cache stores `TerminalRecord` values
 * straight from the wire — every type comes from
 * `@vt/vt-daemon-client` (which re-exports the canonical shapes from
 * `@vt/vt-daemon-protocol`). The patch application is structural and
 * exhaustive on `patch.kind`.
 */

import type {
    TerminalId,
    TerminalRecord,
    TerminalRecordPatch,
    TerminalRegistryEvent,
} from '@vt/vt-daemon-client'

import type {TerminalRegistryEnvelope} from '@/shell/edge/main/runtime/electron/daemon/sync/terminal-registry-sse-subscription'

// ----------------------------------------------------------------------------
// Cache
// ----------------------------------------------------------------------------

const records: Map<string, TerminalRecord> = new Map()

type CacheMutationListener = (snapshot: readonly TerminalRecord[]) => void
const listeners: Set<CacheMutationListener> = new Set()

/** Snapshot accessor. The returned array is freshly constructed; the
 *  caller may mutate it freely. Order is insertion order. */
export function getCachedTerminalRecords(): readonly TerminalRecord[] {
    return Array.from(records.values())
}

/** Point read. Returns null when the cache holds no row for that id. */
export function getCachedTerminalRecord(terminalId: TerminalId): TerminalRecord | null {
    return records.get(terminalId) ?? null
}

/**
 * Wipe the cache. Called from project-switch wiring (Stage 3) before the
 * subscriber resumes against the new project's hub, and from tests
 * between cases.
 */
export function resetTerminalRegistryCache(): void {
    records.clear()
}

/**
 * Replace the cache contents with a fresh snapshot. Used by project-open
 * cold-start: after `bindVtDaemonForProject` resolves and before the
 * `terminal-registry` SSE subscription opens, the caller fetches the
 * authoritative record list via `vtdClient.terminals.getTerminalRecords()`
 * and primes the mirror. Fires listeners exactly once with the new
 * snapshot so downstream consumers (renderer sync, completion notifier,
 * recovery polling) refresh too.
 */
export function primeTerminalRegistryCache(initial: readonly TerminalRecord[]): void {
    records.clear()
    for (const record of initial) {
        records.set(record.terminalId, record)
    }
    fireListeners()
}

/**
 * Register a listener fired after every cache mutation (envelope-driven
 * or cold-start prime). The cache mirror is the canonical change source
 * post-BF-376 outbound — agent-runtime no longer lives in webapp/Main.
 * Returns an unsubscribe handle.
 *
 * Listeners receive the same `readonly TerminalRecord[]` snapshot as
 * `getCachedTerminalRecords()` — call sites that need a stable reference
 * within their handler should treat it as read-only and re-snapshot if
 * they hand it to async work.
 */
export function subscribeToTerminalRegistryCache(
    listener: CacheMutationListener,
): () => void {
    listeners.add(listener)
    return (): void => { listeners.delete(listener) }
}

function fireListeners(): void {
    const snapshot: readonly TerminalRecord[] = getCachedTerminalRecords()
    for (const listener of listeners) {
        try {
            listener(snapshot)
        } catch (err: unknown) {
            console.error('[terminal-registry-bridge] cache listener threw:', err)
        }
    }
}

// ----------------------------------------------------------------------------
// Envelope application
// ----------------------------------------------------------------------------

/**
 * Outcome of applying one envelope:
 *  - `kind: 'cache-mutated'` — one of the registry-mutation events
 *    (`terminal-registered` / `terminal-removed` / `terminal-record-changed`).
 *  - `kind: 'ui-instruction'` — one of the imperative renderer events
 *    (`terminal-ui-launch` / `terminal-ui-child-registered`). The cache
 *    was NOT touched; the caller is expected to forward the embedded
 *    `event` to the renderer.
 *  - `kind: 'dropped'` — the event referenced a terminalId not in the
 *    cache (e.g. `terminal-record-changed` for an id we never saw a
 *    `terminal-registered` for; or a `terminal-removed` for an unknown
 *    id). Mostly defensive.
 */
export type TerminalRegistryEnvelopeOutcome =
    | {readonly kind: 'cache-mutated'; readonly event: TerminalRegistryEvent}
    | {readonly kind: 'ui-instruction'; readonly event: TerminalRegistryEvent}
    | {readonly kind: 'dropped'; readonly reason: string}

/**
 * Apply one envelope to the cache. The envelope is assumed to have
 * already passed the project-switch fence at the SSE subscriber layer;
 * this function performs no project check.
 */
export function applyTerminalRegistryEnvelope(
    envelope: TerminalRegistryEnvelope,
): TerminalRegistryEnvelopeOutcome {
    const event: TerminalRegistryEvent = envelope.event
    switch (event.type) {
        case 'terminal-registered': {
            records.set(event.record.terminalId, event.record)
            fireListeners()
            return {kind: 'cache-mutated', event}
        }
        case 'terminal-removed': {
            const had: boolean = records.delete(event.terminalId)
            if (!had) {
                return {kind: 'dropped', reason: `terminal-removed for unknown id ${event.terminalId}`}
            }
            fireListeners()
            return {kind: 'cache-mutated', event}
        }
        case 'terminal-record-changed': {
            const existing: TerminalRecord | undefined = records.get(event.terminalId)
            if (existing === undefined) {
                return {
                    kind: 'dropped',
                    reason: `terminal-record-changed for unknown id ${event.terminalId}`,
                }
            }
            records.set(event.terminalId, applyPatch(existing, event.patch))
            fireListeners()
            return {kind: 'cache-mutated', event}
        }
        case 'terminal-ui-launch':
        case 'terminal-ui-child-registered':
            return {kind: 'ui-instruction', event}
    }
}

// ----------------------------------------------------------------------------
// Patch application — pure, exhaustive on patch.kind
// ----------------------------------------------------------------------------

function applyPatch(record: TerminalRecord, patch: TerminalRecordPatch): TerminalRecord {
    switch (patch.kind) {
        case 'pinned':
            return {
                ...record,
                terminalData: {...record.terminalData, isPinned: patch.value},
            }
        case 'minimized':
            return {
                ...record,
                terminalData: {...record.terminalData, isMinimized: patch.value},
            }
        case 'done':
            return {
                ...record,
                terminalData: {...record.terminalData, isDone: patch.value},
            }
        case 'lifecycle':
            return {
                ...record,
                terminalData: {...record.terminalData, lifecycle: patch.value},
            }
        case 'activity': {
            const next = {...record.terminalData}
            if (patch.value.lastOutputTime !== undefined) {
                next.lastOutputTime = patch.value.lastOutputTime
            }
            if (patch.value.activityCount !== undefined) {
                next.activityCount = patch.value.activityCount
            }
            return {...record, terminalData: next}
        }
    }
}
