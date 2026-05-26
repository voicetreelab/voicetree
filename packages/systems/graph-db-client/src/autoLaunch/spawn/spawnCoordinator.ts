/**
 * Spawn + readiness coordination for the BF-344 ensure path.
 *
 * Split out of `ensureGraphDaemon.ts` to keep the decision-loop file focused
 * on policy and this file focused on the impure mechanics of "execute one
 * spawn under the cross-process lock and wait for the daemon to finalise
 * its owner record". BF-347 also added cooldown breadcrumb persistence and
 * lifecycle diagnostics around this boundary.
 *
 * Functional shape: a single deep, narrow public entrypoint
 * (`attemptSpawnAndWait`) composes the small adapters in this directory —
 * spawn lock, owner-record IO, health probe, command resolution, cooldown
 * breadcrumb IO, diagnostics emit. The decision rule remains the pure
 * `decideOwnerAction`; this file only sequences side effects.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import type { CallerKind, OwnerRecord } from '../types.ts'
import { GraphDbClient } from '../../GraphDbClient.ts'
import { DaemonLaunchTimeout, UnsafeOwnerError } from '../../errors.ts'
import {
  clearCooldownBreadcrumb,
  decideActiveCooldown,
  readCooldownBreadcrumb,
  writeCooldownBreadcrumb,
} from '../ownership/cooldownBreadcrumb.ts'
import { emitOwnerDiagnostic } from '../diagnostics.ts'
import { probeOwnerHealth } from '../probes/healthIdentityProbe.ts'
import {
  decideOwnerAction,
  type OwnerEvidence,
} from '../ownership/ownerDecision.ts'
import { deleteOwnerRecord, readOwnerRecord } from '../ownership/ownerRecordIo.ts'
import {
  readCommandFingerprintMatch,
  readProcessLiveness,
} from '../probes/processLiveness.ts'
import { resolveCommand, type CommandSpec } from './runtime.ts'
import { acquireSpawnLock } from './spawnLock.ts'

export type SpawnCoordinationOptions = {
  readonly bin?: string
  readonly initialBackoffMs: number
  readonly maxBackoffMs: number
}

export type SpawnAttemptResult = {
  readonly client: GraphDbClient
  readonly port: number
  readonly pid: number
  readonly ownerNonce: string
  readonly launched: boolean
}

/**
 * Build owner-evidence from the on-disk record, runtime probes, and the
 * cooldown breadcrumb. Shared between the discovery loop and the in-spawn
 * wait loop so both see exactly the same projection of vault state.
 */
export async function gatherEvidence(
  canonicalProjectRoot: string,
): Promise<OwnerEvidence> {
  const breadcrumb = await readCooldownBreadcrumb(canonicalProjectRoot)
  const cooldown = decideActiveCooldown(Date.now(), breadcrumb)
  const record = await readOwnerRecord(canonicalProjectRoot)
  if (record === null) {
    return {
      record: null,
      recordedPidLiveness: 'unknown',
      health: { kind: 'unprobed' },
      commandFingerprintMatch: 'unknown',
      cooldown,
    }
  }
  const recordedPidLiveness = readProcessLiveness(record.pid)
  const commandFingerprintMatch =
    recordedPidLiveness === 'alive'
      ? readCommandFingerprintMatch(record.pid, record.commandFingerprint)
      : 'unknown'
  const health =
    record.port === null
      ? { kind: 'unprobed' as const }
      : await probeOwnerHealth(record.port)
  return {
    record,
    recordedPidLiveness,
    health,
    commandFingerprintMatch,
    cooldown,
  }
}

/**
 * Run the spawn step under the cross-process spawn lock. Returns the
 * resulting handle when this caller spawned (or finalised) the daemon,
 * `null` when the spawn lock is held by another live caller (the work-loop
 * loops back to discovery in that case).
 *
 * Writes a cooldown breadcrumb when the spawn was attempted (`spawn-started`
 * emitted) but the daemon never produced a healthy owner record before the
 * deadline. The breadcrumb is cleared on the spawn-ready path.
 */
export async function attemptSpawnAndWait(
  canonicalProjectRoot: string,
  caller: CallerKind,
  attemptId: string,
  options: SpawnCoordinationOptions,
  deadlineMs: number,
  staleHeartbeatMs: number,
  spawnCooldownMs: number,
): Promise<SpawnAttemptResult | null> {
  const acquisition = await acquireSpawnLock(canonicalProjectRoot, process.pid)
  if (acquisition.kind === 'held') {
    return null
  }

  try {
    const preSpawnRecord = await readOwnerRecord(canonicalProjectRoot)
    if (preSpawnRecord !== null && preSpawnRecord.port !== null) {
      const reuseResult = await tryReuseExistingOwner(preSpawnRecord)
      if (reuseResult !== null) return reuseResult
    }

    const command = resolveCommand(canonicalProjectRoot, options.bin)
    const spawnedPid = spawnDaemon(command, caller)
    emitOwnerDiagnostic({
      kind: 'spawn-started',
      attemptId,
      callerKind: caller,
      canonicalProjectRoot,
      nowMs: Date.now(),
      childPid: spawnedPid,
    })

    try {
      const ready = await waitForDaemonHealth(
        canonicalProjectRoot,
        spawnedPid,
        deadlineMs,
        staleHeartbeatMs,
        options,
      )
      emitOwnerDiagnostic({
        kind: 'spawn-ready',
        attemptId,
        callerKind: caller,
        canonicalProjectRoot,
        nowMs: Date.now(),
        pid: ready.pid,
        port: ready.port,
        ownerNonce: ready.ownerNonce,
      })
      await clearCooldownBreadcrumb(canonicalProjectRoot)
      return ready
    } catch (cause) {
      await onSpawnFailure(
        cause,
        canonicalProjectRoot,
        caller,
        attemptId,
        spawnedPid,
        spawnCooldownMs,
      )
      throw cause
    }
  } finally {
    await acquisition.release()
  }
}

async function onSpawnFailure(
  cause: unknown,
  canonicalProjectRoot: string,
  caller: CallerKind,
  attemptId: string,
  spawnedPid: number | null,
  spawnCooldownMs: number,
): Promise<void> {
  const err = cause as Error
  emitOwnerDiagnostic({
    kind: 'spawn-failed',
    attemptId,
    callerKind: caller,
    canonicalProjectRoot,
    nowMs: Date.now(),
    childPid: spawnedPid,
    errorName: err.name,
    errorMessage: err.message,
  })
  // Only DaemonLaunchTimeout means "we spawned and it never came up".
  // UnsafeOwnerError raised by waitForDaemonHealth indicates a racing owner
  // with a different identity — that is not our spawn failing, so we do not
  // write a cooldown for it.
  if (cause instanceof DaemonLaunchTimeout) {
    const now = Date.now()
    await writeCooldownBreadcrumb(canonicalProjectRoot, {
      schemaVersion: 1,
      canonicalProjectRoot,
      writtenAtMs: now,
      untilMs: now + spawnCooldownMs,
      reason: 'spawn-failed',
      writerCallerKind: caller,
      writerPid: process.pid,
      lastErrorName: err.name,
      lastErrorMessage: err.message,
    })
  }
}

async function tryReuseExistingOwner(
  record: OwnerRecord,
): Promise<SpawnAttemptResult | null> {
  if (record.port === null) return null
  const probe = await probeOwnerHealth(record.port)
  if (probe.kind !== 'verified') return null
  if (probe.canonicalProjectRoot !== record.canonicalProjectRoot) return null
  if (probe.ownerNonce !== record.ownerNonce) return null
  return {
    client: clientFor(probe.port),
    port: probe.port,
    pid: probe.pid,
    ownerNonce: probe.ownerNonce,
    launched: false,
  }
}

function spawnDaemon(command: CommandSpec, caller: CallerKind): number | null {
  const child: ChildProcess = spawn(command.cmd, command.args, {
    detached: true,
    env: {
      ...(command.env ?? process.env),
      VT_GRAPHD_CALLER_KIND: caller,
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  child.unref()
  child.on('error', () => {
    // Errors here surface as the wait-for-health loop timing out, which is
    // the right boundary: we want one launch-failure shape, not two.
  })
  return child.pid ?? null
}

async function waitForDaemonHealth(
  canonicalProjectRoot: string,
  spawnedPid: number | null,
  deadlineMs: number,
  staleHeartbeatMs: number,
  options: SpawnCoordinationOptions,
): Promise<SpawnAttemptResult> {
  let backoff = options.initialBackoffMs

  while (Date.now() < deadlineMs) {
    const evidence = await gatherEvidence(canonicalProjectRoot)
    const decision = decideOwnerAction(evidence, {
      nowMs: Date.now(),
      staleHeartbeatMs,
    })
    if (decision.kind === 'reuse') {
      return {
        client: clientFor(decision.port),
        port: decision.port,
        pid: decision.pid,
        ownerNonce: decision.ownerNonce,
        launched: true,
      }
    }
    if (decision.kind === 'unsafe-owner') {
      throw new UnsafeOwnerError(
        canonicalProjectRoot,
        decision.recordedPid,
        decision.reason,
      )
    }
    // wait / claim / stale-reclaim during the spawn window all reduce to
    // "the daemon has not yet finalised its claim". Keep polling.
    await sleep(boundedDelay(backoff, deadlineMs))
    backoff = nextBackoff(backoff, options.maxBackoffMs)
  }

  throw new DaemonLaunchTimeout(
    `vt-graphd spawn (pid ${spawnedPid ?? 'unknown'}) did not become healthy for vault ${canonicalProjectRoot} before deadline`,
  )
}

/**
 * Reclaim a stale owner: only invoked after `decideOwnerAction` has already
 * authorised reclamation through safe-kill predicates (dead pid, OR alive
 * pid with matching command fingerprint). The dead case has nothing to
 * terminate; the alive case is a hung vt-graphd we are authorised to
 * terminate so its owner record can be replaced.
 */
export async function reclaimStaleOwner(
  canonicalProjectRoot: string,
  staleRecord: OwnerRecord,
): Promise<void> {
  if (readProcessLiveness(staleRecord.pid) === 'alive') {
    try {
      process.kill(staleRecord.pid, 'SIGTERM')
    } catch {
      // already gone
    }
    const exitDeadline = Date.now() + 500
    while (
      Date.now() < exitDeadline &&
      readProcessLiveness(staleRecord.pid) === 'alive'
    ) {
      await sleep(25)
    }
  }
  await deleteOwnerRecord(canonicalProjectRoot)
}

export function clientFor(port: number): GraphDbClient {
  return new GraphDbClient({ baseUrl: `http://127.0.0.1:${port}` })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

export function nextBackoff(current: number, ceiling: number): number {
  return Math.min(current * 2, ceiling)
}

export function boundedDelay(backoff: number, deadlineMs: number): number {
  const remaining = deadlineMs - Date.now()
  if (remaining <= 0) return 0
  return Math.min(backoff, remaining)
}
