/**
 * Owner-record lifecycle for the vt-graphd daemon.
 *
 * One public entry, `claimDaemonOwner`, runs the BF-343 protocol:
 *
 *   1. Atomic-create the owner record under `<project>/.voicetree/` with
 *      port=null. Winning the create is the cross-process arbitration —
 *      whoever wins is the sole owner for the canonical project path.
 *   2. If the record already exists, decide between reclaim (recorded pid
 *      dead) and conflict (recorded pid alive). Conflict raises a typed
 *      error so the caller can fail loudly without overwriting an active
 *      owner.
 *   3. Return a handle whose methods are the only sanctioned way to bind
 *      the port into the record, refresh heartbeat, and release the claim
 *      on shutdown.
 *
 * The handle keeps the in-memory record in sync with disk so the daemon's
 * `/health` reader can return owner identity without re-parsing JSON on
 * every probe.
 *
 * All filesystem I/O lives at the edges of this module (ownerRecord.ts);
 * the lifecycle itself just composes those primitives plus the
 * conflict/reclaim decision.
 */

import { randomBytes } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import type {
  CallerKind,
  CommandFingerprint,
  HealthOwner,
  OwnerRecord,
} from '@vt/graph-db-server/contract'
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
} from '@vt/daemon-lifecycle'

/**
 * BF-343 → BF-344 transition: graph-db-client's portDiscovery checks the
 * legacy `graphd.lock` file's existence to decide whether to keep polling
 * for the port. The owner record is the authoritative single-instance
 * arbiter now; we still write a zero-byte `graphd.lock` sidecar as part of
 * the owner lifecycle so the client keeps finding the daemon during the
 * window before BF-344 cuts the client over to the owner record. BF-344
 * removes this sidecar.
 */
const LEGACY_LOCK_FILENAME = 'graphd.lock'

const tracer = trace.getTracer('vt-graphd')

export const HEARTBEAT_INTERVAL_MS = 2_000

export class DaemonOwnerConflictError extends Error {
  readonly code = 'DAEMON_OWNER_CONFLICT'
  constructor(
    readonly canonicalProject: string,
    readonly existingOwner: OwnerRecord,
  ) {
    super(
      `vt-graphd: project ${canonicalProject} already owned by pid ${existingOwner.pid} (nonce ${existingOwner.ownerNonce})`,
    )
    this.name = 'DaemonOwnerConflictError'
  }
}

export type ClaimDaemonOwnerOptions = {
  readonly canonicalProject: string
  readonly callerKind: CallerKind
  readonly contractVersion: string
  readonly commandFingerprint: CommandFingerprint
  readonly clock: () => number
}

export type DaemonOwnerHandle = {
  /**
   * Current in-memory copy of the owner record. Updated in place after
   * each successful disk replace so health/heartbeat readers see the same
   * shape the on-disk record exposes.
   */
  readonly current: () => OwnerRecord
  /**
   * Owner identity projection for `/health`. Returns `null` while the
   * daemon has not yet bound a port. Once `bindPort` resolves with a
   * real port, the projection includes every field BF-343 requires.
   */
  readonly health: () => HealthOwner | null
  /** Persist the bound loopback port and update in-memory state. */
  readonly bindPort: (port: number) => Promise<void>
  /** Start the heartbeat ticker; returns a stop callback. */
  readonly startHeartbeat: (intervalMs?: number) => () => void
  /** Delete the owner record atomically. Idempotent. */
  readonly release: () => Promise<void>
}

export async function claimDaemonOwner(
  options: ClaimDaemonOwnerOptions,
): Promise<DaemonOwnerHandle> {
  return tracer.startActiveSpan('daemon.claim-owner', async (span) => {
    span.setAttribute('project', options.canonicalProject)
    try {
      const path = ownerRecordFile.pathFor(options.canonicalProject, 'graphd')
      let record = createInitialRecord({
        daemonKind: 'graphd',
        canonicalProject: options.canonicalProject,
        pid: process.pid,
        ppid: process.ppid ?? 0,
        callerKind: options.callerKind,
        contractVersion: options.contractVersion,
        commandFingerprint: options.commandFingerprint,
        nowMs: options.clock(),
      })

      record = await acquireOwnerRecord(path, record, options.canonicalProject)
      await writeLegacyLockSidecar(options.canonicalProject, record.pid)
      span.setAttribute('owner.nonce', record.ownerNonce)
      span.setAttribute('owner.pid', record.pid)
      return makeHandle(path, record, options.clock, options.canonicalProject)
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      span.end()
    }
  })
}

async function acquireOwnerRecord(
  path: string,
  desired: OwnerRecord,
  canonicalProject: string,
): Promise<OwnerRecord> {
  const firstAttempt = await tryAtomicCreate(path, desired)
  if (firstAttempt.kind === 'created') return desired

  const existing = decodeOwnerRecord(firstAttempt.existingRaw)
  if (existing !== null && isOwnerPidAlive(existing.pid)) {
    throw new DaemonOwnerConflictError(canonicalProject, existing)
  }

  // The existing record is either undecodable (corrupt) or held by a dead
  // pid. Either way we are authorised to remove it and claim afresh. If
  // another process reclaims simultaneously, the second create attempt will
  // see EEXIST again; we then re-check liveness against whoever won.
  await deleteOwnerRecord(path)
  const secondAttempt = await tryAtomicCreate(path, desired)
  if (secondAttempt.kind === 'created') return desired

  const racer = decodeOwnerRecord(secondAttempt.existingRaw)
  if (racer !== null && isOwnerPidAlive(racer.pid)) {
    throw new DaemonOwnerConflictError(canonicalProject, racer)
  }
  throw new Error(
    `vt-graphd: failed to claim owner for ${canonicalProject} (record contention)`,
  )
}

function makeHandle(
  path: string,
  initial: OwnerRecord,
  clock: () => number,
  canonicalProject: string,
): DaemonOwnerHandle {
  let current = initial
  let writeInFlight: Promise<void> = Promise.resolve()
  let released = false
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null

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

  return {
    current: () => current,
    health: () => healthFromRecord(current),
    bindPort: async (port: number) => {
      if (released) {
        throw new Error('vt-graphd: cannot bind port — owner already released')
      }
      await enqueueReplace(withBoundPort(current, port))
    },
    startHeartbeat: (intervalMs = HEARTBEAT_INTERVAL_MS): (() => void) => {
      if (heartbeatTimer !== null) {
        return () => stopHeartbeat()
      }
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
      try {
        await writeInFlight
      } catch {
        /* swallow */
      }
      await deleteOwnerRecord(path)
      await deleteLegacyLockSidecar(canonicalProject)
    },
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer === null) return
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function makeTempSuffix(): string {
  return `${process.pid}.${randomBytes(4).toString('hex')}`
}

function legacyLockPathFor(projectDir: string): string {
  return join(getProjectDotVoicetreePath(projectDir), LEGACY_LOCK_FILENAME)
}

async function writeLegacyLockSidecar(projectDir: string, pid: number): Promise<void> {
  await writeFile(legacyLockPathFor(projectDir), `${pid}\n`, 'utf8')
}

async function deleteLegacyLockSidecar(projectDir: string): Promise<void> {
  try {
    await unlink(legacyLockPathFor(projectDir))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

function healthFromRecord(record: OwnerRecord): HealthOwner | null {
  if (record.port === null) return null
  return {
    schemaVersion: record.schemaVersion,
    canonicalProject: record.canonicalProject,
    pid: record.pid,
    ppid: record.ppid,
    port: record.port,
    ownerNonce: record.ownerNonce,
    contractVersion: record.contractVersion,
  }
}
