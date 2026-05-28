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
 * (`attemptSpawnAndWait`) composes the daemon-lifecycle primitives —
 * spawn lock, owner-record IO, health probe, cooldown breadcrumb IO,
 * diagnostics emit — plus a per-daemon-kind `clientFor(port): TClient`
 * supplied by the caller. The decision rule remains the pure
 * `decideOwnerAction`; this file only sequences side effects.
 *
 * BF-369: templated over `TClient` and parameterised by `daemonKind` so
 * the same orchestrator drives both vt-graphd (`clientFor` returns a
 * `GraphDbClient`) and vt-daemon (BF-373, `clientFor` returns a
 * `VtDaemonClient`) without forcing daemon-lifecycle to depend on either
 * HTTP-client constructor.
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  acquireSpawnLock,
  boundedDelay,
  clearCooldownBreadcrumb,
  DaemonLaunchTimeout,
  decideActiveCooldown,
  decideOwnerAction,
  deleteOwnerRecord,
  emitOwnerDiagnostic,
  nextBackoff,
  ownerRecordFile,
  probeOwnerHealth,
  readCommandFingerprintMatch,
  readCooldownBreadcrumb,
  readOwnerRecord,
  readProcessLiveness,
  sleep,
  spawnDaemon,
  UnsafeOwnerError,
  writeCooldownBreadcrumb,
  type CallerKind,
  type DaemonKind,
  type OwnerEvidence,
  type OwnerRecord,
} from '@vt/daemon-lifecycle'
import type { CommandSpec } from './runtime.ts'

/**
 * Resolve the per-vault daemon log path and ensure its parent directory
 * exists so `openSync(..., 'a')` inside `spawnDaemon` cannot ENOENT.
 *
 * The daemon would itself create `.voicetree/` on first owner-record
 * write, but the launcher opens the log fd BEFORE the daemon starts —
 * so the launcher has to ensure the directory.
 */
function daemonLogPath(canonicalVault: string, daemonKind: DaemonKind): string {
  const dir = join(canonicalVault, '.voicetree')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${daemonKind}.log`)
}

/**
 * Resolves the daemon spawn command for `(vault, override?)`. Lives in
 * the per-daemon client package because each daemon takes its own argv
 * shape (graphd wants `--project-root <vault>`; vtd wants `--vault
 * <vault>`) and locates its entrypoint differently (graphd hunts for
 * sibling bundles inside `@voicetree/cli`; vtd resolves the `@vt/vt-daemon`
 * package directly). Passing the resolver in keeps spawnCoordinator
 * daemon-kind-agnostic without forcing a shared resolver to know about
 * both bin layouts.
 */
export type CommandResolver = (vault: string, override?: string) => CommandSpec

export type SpawnCoordinationOptions<TClient> = {
  readonly bin?: string
  readonly daemonKind: DaemonKind
  readonly clientFor: (port: number) => TClient
  readonly resolveCommand: CommandResolver
  readonly initialBackoffMs: number
  readonly maxBackoffMs: number
}

export type SpawnAttemptResult<TClient> = {
  readonly client: TClient
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
  canonicalVault: string,
  daemonKind: DaemonKind,
): Promise<OwnerEvidence> {
  const breadcrumb = await readCooldownBreadcrumb(canonicalVault, daemonKind)
  const cooldown = decideActiveCooldown(Date.now(), breadcrumb)
  const record = await readOwnerRecord(canonicalVault, daemonKind)
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
  // `daemonKind` is load-bearing: probeOwnerHealth validates the response
  // body against the daemon-kind's wire schema. Omitting it would default
  // to graphd's HealthResponseSchema and reject every vtd `/health` body
  // as a parse failure → spurious `unreachable` evidence for VTD.
  const health =
    record.port === null
      ? { kind: 'unprobed' as const }
      : await probeOwnerHealth(record.port, { daemonKind, fetchImpl: fetch })
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
export async function attemptSpawnAndWait<TClient>(
  canonicalVault: string,
  caller: CallerKind,
  attemptId: string,
  options: SpawnCoordinationOptions<TClient>,
  deadlineMs: number,
  staleHeartbeatMs: number,
  spawnCooldownMs: number,
): Promise<SpawnAttemptResult<TClient> | null> {
  const acquisition = await acquireSpawnLock(
    canonicalVault,
    options.daemonKind,
    process.pid,
  )
  if (acquisition.kind === 'held') {
    return null
  }

  try {
    const preSpawnRecord = await readOwnerRecord(canonicalVault, options.daemonKind)
    if (preSpawnRecord !== null && preSpawnRecord.port !== null) {
      const reuseResult = await tryReuseExistingOwner(
        preSpawnRecord,
        options.daemonKind,
        options.clientFor,
      )
      if (reuseResult !== null) return reuseResult
    }

    const command = options.resolveCommand(canonicalVault, options.bin)
    const spawned = spawnDaemon({
      daemonKind: options.daemonKind,
      cmd: command.cmd,
      args: command.args,
      env: command.env,
      caller,
      logPath: daemonLogPath(canonicalVault, options.daemonKind),
    })
    emitOwnerDiagnostic({
      kind: 'spawn-started',
      attemptId,
      callerKind: caller,
      canonicalVault,
      nowMs: Date.now(),
      childPid: spawned.pid,
    })

    try {
      const ready = await waitForDaemonHealth(
        canonicalVault,
        spawned.pid,
        deadlineMs,
        staleHeartbeatMs,
        options,
      )
      emitOwnerDiagnostic({
        kind: 'spawn-ready',
        attemptId,
        callerKind: caller,
        canonicalVault,
        nowMs: Date.now(),
        pid: ready.pid,
        port: ready.port,
        ownerNonce: ready.ownerNonce,
      })
      await clearCooldownBreadcrumb(canonicalVault, options.daemonKind)
      return ready
    } catch (cause) {
      await onSpawnFailure(
        cause,
        canonicalVault,
        options.daemonKind,
        caller,
        attemptId,
        spawned.pid,
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
  canonicalVault: string,
  daemonKind: DaemonKind,
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
    canonicalVault,
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
    const writerPid: number = process.pid
    await writeCooldownBreadcrumb(canonicalVault, daemonKind, {
      schemaVersion: 1,
      canonicalVault,
      writtenAtMs: now,
      untilMs: now + spawnCooldownMs,
      reason: 'spawn-failed',
      writerCallerKind: caller,
      writerPid,
      lastErrorName: err.name,
      lastErrorMessage: err.message,
    }, writerPid)
  }
}

async function tryReuseExistingOwner<TClient>(
  record: OwnerRecord,
  daemonKind: DaemonKind,
  clientFor: (port: number) => TClient,
): Promise<SpawnAttemptResult<TClient> | null> {
  if (record.port === null) return null
  // Threading `daemonKind` is load-bearing for vtd — see the comment on
  // gatherEvidence above. A graphd-shaped probe would reject every vtd
  // body as a parse failure and surface as `unreachable`, never `verified`.
  const probe = await probeOwnerHealth(record.port, { daemonKind, fetchImpl: fetch })
  if (probe.kind !== 'verified') return null
  if (probe.canonicalVault !== record.canonicalVault) return null
  if (probe.ownerNonce !== record.ownerNonce) return null
  return {
    client: clientFor(probe.port),
    port: probe.port,
    pid: probe.pid,
    ownerNonce: probe.ownerNonce,
    launched: false,
  }
}

async function waitForDaemonHealth<TClient>(
  canonicalVault: string,
  spawnedPid: number | null,
  deadlineMs: number,
  staleHeartbeatMs: number,
  options: SpawnCoordinationOptions<TClient>,
): Promise<SpawnAttemptResult<TClient>> {
  let backoff = options.initialBackoffMs

  while (Date.now() < deadlineMs) {
    const evidence = await gatherEvidence(canonicalVault, options.daemonKind)
    const decision = decideOwnerAction(evidence, {
      nowMs: Date.now(),
      staleHeartbeatMs,
    })
    if (decision.kind === 'reuse') {
      return {
        client: options.clientFor(decision.port),
        port: decision.port,
        pid: decision.pid,
        ownerNonce: decision.ownerNonce,
        launched: true,
      }
    }
    if (decision.kind === 'unsafe-owner') {
      throw new UnsafeOwnerError(
        canonicalVault,
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
    `daemon spawn (pid ${spawnedPid ?? 'unknown'}) did not become healthy for vault ${canonicalVault} before deadline`,
  )
}

/**
 * Reclaim a stale owner: only invoked after `decideOwnerAction` has already
 * authorised reclamation through safe-kill predicates (dead pid, OR alive
 * pid with matching command fingerprint). The dead case has nothing to
 * terminate; the alive case is a hung daemon we are authorised to
 * terminate so its owner record can be replaced.
 */
export async function reclaimStaleOwner(
  canonicalVault: string,
  daemonKind: DaemonKind,
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
  await deleteOwnerRecord(ownerRecordFile.pathFor(canonicalVault, daemonKind))
}
