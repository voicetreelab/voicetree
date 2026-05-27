/**
 * Public entry for the owner-aware client launcher for the standalone
 * vt-daemon (VTD) controller.
 *
 * `ensureVtDaemonForVault` is the only sanctioned way for a client to
 * obtain a {@link VtDaemonClient} bound to the authoritative VTD owner
 * for a vault. Per-vault, NOT per-process: one VTD per vault per machine,
 * mirroring `ensureGraphDaemonForVault`. Multiple callers for the same
 * vault converge on one daemon via the BF-348 in-process single-flight
 * + cross-process spawn lock; multiple callers for DIFFERENT vaults each
 * get their own VTD process.
 *
 * This file is a 1:1 mirror of
 * `packages/systems/graph-db-client/src/autoLaunch/ensureGraphDaemon.ts`,
 * differing only in:
 *   1. `clientFor` constructs `VtDaemonClient` (instead of `GraphDbClient`).
 *   2. `EnsureVtDaemonResult` carries `authToken` (graphd has no auth).
 *   3. `resolveCommand` is vtd's (`--vault`, not `--project-root`).
 *   4. The cooldown breadcrumb and spawn lock files are vtd-scoped
 *      (`vtd.cooldown.json`, `vtd.spawn.lock`).
 *
 * The orchestrator `attemptSpawnAndWait<VtDaemonClient>` is the SAME
 * orchestrator graphd uses — imported from `@vt/graph-db-client` per
 * BF-369's deep function plan. Duplicating it here would risk the two
 * protocols drifting and silently breaking BF-374's storm-regression
 * coverage.
 */

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  boundedDelay,
  DaemonLaunchTimeout,
  decideOwnerAction,
  emitOwnerDiagnostic,
  nextBackoff,
  OwnerSpawnCooldownError,
  OwnerWaitTimeoutError,
  readOwnerRecord,
  sleep,
  UnsafeOwnerError,
  type CallerKind,
  type OwnerDecision,
} from '@vt/daemon-lifecycle'
import {
  attemptSpawnAndWait,
  gatherEvidence,
  reclaimStaleOwner,
} from '@vt/graph-db-client/autoLaunch/spawnCoordinator'
import { VtDaemonClient } from '../VtDaemonClient.ts'
import { vtClientFor } from './clientFor.ts'
import { resolveCommand } from './runtime.ts'

export type EnsureVtDaemonOptions = {
  /** Hard deadline for the whole ensure call. Default 5000ms. */
  readonly timeoutMs?: number
  /**
   * Optional override of the daemon command (`<bin> [args] --vault <path>`).
   * Primarily for tests that point at a fake VTD entrypoint. Also honored
   * via `VT_DAEMON_BIN` env var inside the runtime resolver.
   */
  readonly bin?: string
  /**
   * Maximum heartbeat age tolerated before stale-reclaim becomes possible.
   * Default 15s (matches graphd's heartbeats-every-2s cadence).
   */
  readonly staleHeartbeatMs?: number
  /** Initial poll backoff. Default 50ms. */
  readonly initialBackoffMs?: number
  /** Maximum poll backoff. Default 400ms. */
  readonly maxBackoffMs?: number
  /**
   * Cooldown window persisted to `<vault>/.voicetree/vtd.cooldown.json`
   * after a spawn fails. Subsequent ensure calls within this window
   * short-circuit with {@link OwnerSpawnCooldownError} before re-spawning.
   * Default 5000ms.
   */
  readonly spawnCooldownMs?: number
}

export type EnsureVtDaemonResult = {
  readonly client: VtDaemonClient
  readonly port: number
  readonly pid: number
  readonly ownerNonce: string
  /**
   * Bearer auth token the daemon published to
   * `<vault>/.voicetree/auth-token` on startup. The same value is closed
   * over inside `client` for `rpc()` calls; surfaced here so Phase 2
   * consumers (Electron Main → renderer IPC, voicetree-cli serve) can
   * pass it across a process boundary without re-reading the file.
   */
  readonly authToken: string
  /**
   * True when this call spawned the daemon child that won ownership.
   * False when an existing healthy owner was reused or a waited-on
   * in-flight owner finalised before our spawn attempt.
   */
  readonly launched: boolean
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_STALE_HEARTBEAT_MS = 15_000
const DEFAULT_INITIAL_BACKOFF_MS = 50
const DEFAULT_MAX_BACKOFF_MS = 400
const DEFAULT_SPAWN_COOLDOWN_MS = 5_000

// Per-process single-flight. Distinct from graphd's `inflightByVault` map
// — VTD-keyed, so a concurrent graphd ensure + vtd ensure for the same
// vault do not block each other. This layer plus the cross-process
// `vtd.spawn.lock` (acquired inside `attemptSpawnAndWait`) are BOTH
// required for BF-348 fork-storm prevention; removing either breaks
// BF-374's storm tests.
const inflightByVault = new Map<string, Promise<EnsureVtDaemonResult>>()

export async function ensureVtDaemonForVault(
  vault: string,
  caller: CallerKind,
  options: EnsureVtDaemonOptions = {},
): Promise<EnsureVtDaemonResult> {
  const canonicalVault = resolve(vault)
  const existing = inflightByVault.get(canonicalVault)
  if (existing) return existing

  const work = runEnsure(canonicalVault, caller, options).finally(() => {
    inflightByVault.delete(canonicalVault)
  })
  inflightByVault.set(canonicalVault, work)
  return work
}

type EnsureContext = {
  readonly canonicalVault: string
  readonly caller: CallerKind
  /**
   * Per-call UUID carried into every {@link emitOwnerDiagnostic} so
   * listeners can correlate a chain without inferring causality from
   * timing.
   */
  readonly attemptId: string
  readonly options: EnsureVtDaemonOptions
  readonly deadlineMs: number
  readonly staleHeartbeatMs: number
  readonly initialBackoffMs: number
  readonly maxBackoffMs: number
  readonly spawnCooldownMs: number
}

type LoopOutcome =
  | { readonly kind: 'done'; readonly result: EnsureVtDaemonResult }
  | { readonly kind: 'continue'; readonly nextBackoff: number }

async function runEnsure(
  canonicalVault: string,
  caller: CallerKind,
  options: EnsureVtDaemonOptions,
): Promise<EnsureVtDaemonResult> {
  await mkdir(`${canonicalVault}/.voicetree`, { recursive: true })
  const ctx = makeEnsureContext(canonicalVault, caller, options)
  let backoff = ctx.initialBackoffMs

  while (Date.now() < ctx.deadlineMs) {
    const evidence = await gatherEvidence(canonicalVault, 'vtd')
    const decision = decideOwnerAction(evidence, {
      nowMs: Date.now(),
      staleHeartbeatMs: ctx.staleHeartbeatMs,
    })
    const outcome = await handleDecision(decision, ctx, backoff)
    if (outcome.kind === 'done') return outcome.result
    backoff = outcome.nextBackoff
  }

  throw await timeoutError(canonicalVault)
}

function makeEnsureContext(
  canonicalVault: string,
  caller: CallerKind,
  options: EnsureVtDaemonOptions,
): EnsureContext {
  return {
    canonicalVault,
    caller,
    attemptId: randomUUID(),
    options,
    deadlineMs: Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    staleHeartbeatMs:
      options.staleHeartbeatMs ?? DEFAULT_STALE_HEARTBEAT_MS,
    initialBackoffMs:
      options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS,
    maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
    spawnCooldownMs:
      options.spawnCooldownMs ?? DEFAULT_SPAWN_COOLDOWN_MS,
  }
}

/**
 * Map one {@link OwnerDecision} to its loop effect. Each branch is either
 * a terminal outcome (return / throw) or a continuation with the next
 * backoff value. Mirrors graphd's `handleDecision` 1:1 — pulling the
 * dispatch out of {@link runEnsure} keeps the orchestrator a flat
 * while-loop and the per-branch effects each readable on their own.
 */
async function handleDecision(
  decision: OwnerDecision,
  ctx: EnsureContext,
  backoff: number,
): Promise<LoopOutcome> {
  switch (decision.kind) {
    case 'reuse': {
      emitOwnerDiagnostic({
        kind: 'reuse',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalVault: ctx.canonicalVault,
        nowMs: Date.now(),
        pid: decision.pid,
        port: decision.port,
        ownerNonce: decision.ownerNonce,
      })
      return {
        kind: 'done',
        result: finaliseReuse(
          ctx.canonicalVault,
          decision.port,
          decision.pid,
          decision.ownerNonce,
        ),
      }
    }
    case 'wait': {
      emitOwnerDiagnostic({
        kind: 'wait',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalVault: ctx.canonicalVault,
        nowMs: Date.now(),
        reason: decision.reason,
        recordedPid: decision.recordedPid,
        recordedPort: decision.recordedPort,
      })
      return waitAndContinue(ctx, backoff)
    }
    case 'claim': {
      emitOwnerDiagnostic({
        kind: 'claim-attempt',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalVault: ctx.canonicalVault,
        nowMs: Date.now(),
        reason: 'no-owner',
      })
      const spawnResult = await attemptSpawnAndWait<VtDaemonClient>(
        ctx.canonicalVault,
        ctx.caller,
        ctx.attemptId,
        {
          bin: ctx.options.bin,
          daemonKind: 'vtd',
          clientFor: (port) => vtClientFor(port, ctx.canonicalVault),
          resolveCommand,
          initialBackoffMs: ctx.initialBackoffMs,
          maxBackoffMs: ctx.maxBackoffMs,
        },
        ctx.deadlineMs,
        ctx.staleHeartbeatMs,
        ctx.spawnCooldownMs,
      )
      if (spawnResult !== null) {
        emitOwnerDiagnostic({
          kind: 'acquired',
          attemptId: ctx.attemptId,
          callerKind: ctx.caller,
          canonicalVault: ctx.canonicalVault,
          nowMs: Date.now(),
          pid: spawnResult.pid,
          port: spawnResult.port,
          ownerNonce: spawnResult.ownerNonce,
        })
        return {
          kind: 'done',
          result: {
            client: spawnResult.client,
            port: spawnResult.port,
            pid: spawnResult.pid,
            ownerNonce: spawnResult.ownerNonce,
            authToken: spawnResult.client.authToken,
            launched: spawnResult.launched,
          },
        }
      }
      // Lost the spawn lock or another caller's claim raced ahead; loop
      // back to discovery and reuse/wait on their owner.
      return waitAndContinue(ctx, backoff)
    }
    case 'stale-reclaim': {
      emitOwnerDiagnostic({
        kind: 'claim-attempt',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalVault: ctx.canonicalVault,
        nowMs: Date.now(),
        reason: 'stale-reclaim',
      })
      await reclaimStaleOwner(ctx.canonicalVault, 'vtd', decision.staleRecord)
      emitOwnerDiagnostic({
        kind: 'stale-reclaimed',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalVault: ctx.canonicalVault,
        nowMs: Date.now(),
        reason: decision.reason,
        recordedPid: decision.staleRecord.pid,
      })
      return { kind: 'continue', nextBackoff: ctx.initialBackoffMs }
    }
    case 'unsafe-owner':
      throw new UnsafeOwnerError(
        ctx.canonicalVault,
        decision.recordedPid,
        decision.reason,
      )
    case 'cooldown-suppressed': {
      emitOwnerDiagnostic({
        kind: 'cooldown-suppressed',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalVault: ctx.canonicalVault,
        nowMs: Date.now(),
        untilMs: decision.untilMs,
        reason: decision.reason,
      })
      throw new OwnerSpawnCooldownError(
        ctx.canonicalVault,
        decision.untilMs,
        decision.reason,
      )
    }
  }
}

async function waitAndContinue(
  ctx: EnsureContext,
  backoff: number,
): Promise<LoopOutcome> {
  await sleep(boundedDelay(backoff, ctx.deadlineMs))
  return {
    kind: 'continue',
    nextBackoff: nextBackoff(backoff, ctx.maxBackoffMs),
  }
}

/**
 * Decide which timeout shape to throw when the work-loop deadline expires.
 * Distinguishes "we were waiting on an in-flight owner" (record on disk)
 * from "we never even got a record" (no owner ever materialised).
 */
async function timeoutError(canonicalVault: string): Promise<Error> {
  const finalRecord = await readOwnerRecord(canonicalVault, 'vtd')
  if (finalRecord !== null) {
    return new OwnerWaitTimeoutError(canonicalVault, finalRecord.pid)
  }
  return new DaemonLaunchTimeout(
    `vt-daemon ensure for vault ${canonicalVault} did not produce an owner before deadline`,
  )
}

function finaliseReuse(
  canonicalVault: string,
  port: number,
  pid: number,
  ownerNonce: string,
): EnsureVtDaemonResult {
  const client = vtClientFor(port, canonicalVault)
  return {
    client,
    port,
    pid,
    ownerNonce,
    authToken: client.authToken,
    launched: false,
  }
}
