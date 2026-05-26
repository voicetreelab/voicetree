/**
 * Owner-record lifecycle for the standalone vt-daemon (VTD) controller.
 *
 * Mirrors `daemonOwnerLifecycle.ts` in graph-db-server but:
 *
 *   - threads `daemonKind: 'vtd'` through every record/path resolution so
 *     a vault may host one `graphd` daemon and one `vtd` daemon at the
 *     same time without their state colliding;
 *   - stamps {@link VTD_CONTRACT_VERSION} (distinct from graphd's
 *     `CONTRACT_VERSION`) so a `/health` probe surfaces the VTD contract,
 *     not graphd's;
 *   - writes NO legacy lock sidecar. graphd carries a `graphd.lock` shim
 *     for BF-343→BF-344 transition compatibility; VTD has no such legacy
 *     and starts clean.
 *
 * Public surface (one function + one handle type + one error class):
 *
 *   - {@link claimVtDaemonOwner} — atomic claim under
 *     `<vault>/.voicetree/vtd.owner.json`. On contention it throws
 *     {@link VtDaemonOwnerConflictError} so the caller can fail loudly;
 *     wait/retry policy belongs in the ensure path (BF-373), not here.
 *   - {@link VtDaemonOwnerHandle} — the only sanctioned way to bind the
 *     port, refresh heartbeat, project owner identity for `/health`, and
 *     release the claim on shutdown.
 *   - {@link VtDaemonOwnerConflictError} — typed conflict raised when an
 *     existing owner is alive.
 *
 * All filesystem I/O lives behind the daemon-lifecycle primitives
 * (`tryAtomicCreate`, `atomicReplaceOwnerRecord`, `deleteOwnerRecord`,
 * `isOwnerPidAlive`); this module composes those primitives plus the
 * conflict/reclaim decision and the per-handle write-serialisation chain.
 */

import { randomBytes } from 'node:crypto'
import {
    atomicReplaceOwnerRecord,
    createInitialRecord,
    decodeOwnerRecord,
    deleteOwnerRecord,
    isOwnerPidAlive,
    ownerRecordFile,
    tryAtomicCreate,
    withBoundPort,
    withHeartbeat,
    type CallerKind,
    type CommandFingerprint,
    type OwnerRecord,
} from '@vt/daemon-lifecycle'
import type { VtDaemonHealthOwner } from '../contract.ts'

/**
 * Default heartbeat cadence. Mirrors graphd's 2s value (see
 * `daemonOwnerLifecycle.ts:HEARTBEAT_INTERVAL_MS`). At each tick the handle
 * atomically rewrites the on-disk record with a bumped `heartbeatAtMs`.
 * Do NOT shorten without measuring filesystem contention — on a NFS-mounted
 * vault the write+rename round-trip could become expensive.
 */
export const VTD_HEARTBEAT_INTERVAL_MS = 2_000

export class VtDaemonOwnerConflictError extends Error {
    readonly code = 'VT_DAEMON_OWNER_CONFLICT'
    constructor(
        readonly canonicalVault: string,
        readonly existingOwner: OwnerRecord,
    ) {
        super(
            `vt-daemon: vault ${canonicalVault} already owned by pid ${existingOwner.pid} (nonce ${existingOwner.ownerNonce})`,
        )
        this.name = 'VtDaemonOwnerConflictError'
    }
}

export type ClaimVtDaemonOwnerOptions = {
    readonly canonicalVault: string
    readonly callerKind: CallerKind
    readonly contractVersion: string
    readonly commandFingerprint: CommandFingerprint
    readonly clock: () => number
}

export type VtDaemonOwnerHandle = {
    /**
     * Current in-memory copy of the owner record. Updated in place after
     * each successful disk replace so health/heartbeat readers see the same
     * shape the on-disk record exposes.
     */
    readonly current: () => OwnerRecord
    /**
     * Owner-identity projection for `/health` (BF-372). Returns `null`
     * while the daemon has not yet bound a port. Once `bindPort` resolves
     * with a real port, the projection carries every field a peer needs to
     * verify "is this the daemon I am allowed to use?".
     */
    readonly health: () => VtDaemonHealthOwner | null
    /** Persist the bound loopback port and update in-memory state. */
    readonly bindPort: (port: number) => Promise<void>
    /** Start the heartbeat ticker; returns a stop callback. */
    readonly startHeartbeat: (intervalMs?: number) => () => void
    /**
     * Delete the owner record. Idempotent across repeated calls and across
     * absent-on-disk states. Drains in-flight writes BEFORE deleting so a
     * heartbeat tick pending behind the chain cannot race past `release`
     * and re-create the record on disk.
     */
    readonly release: () => Promise<void>
}

export async function claimVtDaemonOwner(
    options: ClaimVtDaemonOwnerOptions,
): Promise<VtDaemonOwnerHandle> {
    const path = ownerRecordFile.pathFor(options.canonicalVault, 'vtd')
    const initial = createInitialRecord({
        daemonKind: 'vtd',
        canonicalVault: options.canonicalVault,
        pid: process.pid,
        ppid: process.ppid ?? 0,
        callerKind: options.callerKind,
        contractVersion: options.contractVersion,
        commandFingerprint: options.commandFingerprint,
        nowMs: options.clock(),
    })
    const claimed = await acquireOwnerRecord(path, initial, options.canonicalVault)
    return makeHandle(path, claimed, options.clock)
}

async function acquireOwnerRecord(
    path: string,
    desired: OwnerRecord,
    canonicalVault: string,
): Promise<OwnerRecord> {
    const firstAttempt = await tryAtomicCreate(path, desired)
    if (firstAttempt.kind === 'created') return desired

    const existing = decodeOwnerRecord(firstAttempt.existingRaw)
    if (existing !== null && isOwnerPidAlive(existing.pid)) {
        throw new VtDaemonOwnerConflictError(canonicalVault, existing)
    }

    // The existing record is either undecodable (corrupt) or held by a dead
    // pid. Either way we are authorised to remove it and claim afresh. If
    // another process reclaims simultaneously, the second create attempt
    // will see EEXIST again; we then re-check liveness against whoever won.
    await deleteOwnerRecord(path)
    const secondAttempt = await tryAtomicCreate(path, desired)
    if (secondAttempt.kind === 'created') return desired

    const racer = decodeOwnerRecord(secondAttempt.existingRaw)
    if (racer !== null && isOwnerPidAlive(racer.pid)) {
        throw new VtDaemonOwnerConflictError(canonicalVault, racer)
    }
    throw new Error(
        `vt-daemon: failed to claim owner for ${canonicalVault} (record contention)`,
    )
}

function makeHandle(
    path: string,
    initial: OwnerRecord,
    clock: () => number,
): VtDaemonOwnerHandle {
    let current = initial
    let writeInFlight: Promise<void> = Promise.resolve()
    let released = false
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null

    // Per-handle write serialisation: every disk replace is chained onto
    // the previous one's settlement so `bindPort(N)` and a concurrent
    // heartbeat tick cannot interleave their writes. Without this chain a
    // heartbeat tick could win the race and replay the pre-port record onto
    // disk after `bindPort` wrote it — losing the port until the next tick.
    // See `daemonOwnerLifecycle.ts:enqueueReplace` for the graphd reference.
    const enqueueReplace = async (next: OwnerRecord): Promise<void> => {
        const previous = writeInFlight
        const task = previous.then(async () => {
            if (released) return
            await atomicReplaceOwnerRecord(path, next, makeTempSuffix())
            current = next
        })
        writeInFlight = task.catch(() => undefined)
        return task
    }

    const stopHeartbeat = (): void => {
        if (heartbeatTimer === null) return
        clearInterval(heartbeatTimer)
        heartbeatTimer = null
    }

    return {
        current: () => current,
        health: () => healthFromRecord(current),
        bindPort: async (port: number) => {
            if (released) {
                throw new Error(
                    'vt-daemon: cannot bind port — owner already released',
                )
            }
            await enqueueReplace(withBoundPort(current, port))
        },
        startHeartbeat: (intervalMs = VTD_HEARTBEAT_INTERVAL_MS): (() => void) => {
            if (heartbeatTimer !== null) return () => stopHeartbeat()
            const tick = (): void => {
                if (released) return
                void enqueueReplace(withHeartbeat(current, clock())).catch(() => {})
            }
            heartbeatTimer = setInterval(tick, intervalMs)
            heartbeatTimer.unref?.()
            return () => stopHeartbeat()
        },
        release: async () => {
            if (released) return
            released = true
            stopHeartbeat()
            // Drain pending writes (heartbeat tick, in-flight bindPort)
            // BEFORE deleting. Skipping this lets a pending tick race past
            // the delete and re-create the record — orphan record breaks
            // the next claim. See BF-370 Gotcha #2.
            try {
                await writeInFlight
            } catch {
                /* swallow — a failed replace must not block release */
            }
            await deleteOwnerRecord(path)
        },
    }
}

function makeTempSuffix(): string {
    return `${process.pid}.${randomBytes(4).toString('hex')}`
}

function healthFromRecord(record: OwnerRecord): VtDaemonHealthOwner | null {
    if (record.port === null) return null
    return {
        schemaVersion: record.schemaVersion,
        canonicalVault: record.canonicalVault,
        pid: record.pid,
        ppid: record.ppid,
        port: record.port,
        ownerNonce: record.ownerNonce,
        contractVersion: record.contractVersion,
    }
}
