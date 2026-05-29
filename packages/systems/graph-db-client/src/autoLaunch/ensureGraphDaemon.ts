/**
 * Public entry for the owner-aware client launcher.
 *
 * `ensureGraphDaemonForProject` is the only sanctioned way for the client to
 * obtain a {@link GraphDbClient} bound to the authoritative vt-graphd owner
 * for a project. It coordinates discovery, waiting, claiming, spawning,
 * reclamation, and cooldown suppression by wrapping pure {@link
 * decideOwnerAction} with the impure IO adapters in `@vt/daemon-lifecycle`.
 *
 * Functional shape: one deep, narrow public function backed by a pure
 * decision rule (`decideOwnerAction`) and the impure spawn/wait/reclaim
 * helpers in `spawnCoordinator.ts`. The orchestrator only sequences them
 * and emits structured ownership diagnostics (BF-347) at each transition.
 *
 * The function is safe to call concurrently from the same Node process for
 * the same project — an in-process single-flight cache coalesces concurrent
 * callers into one work-loop. Cross-process concurrency is serialised via
 * the spawn lock so 100 callers across 100 processes still produce exactly
 * one vt-graphd spawn.
 */

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {getProjectDotVoicetreePath} from '@vt/paths'
import {
  boundedDelay,
  decideOwnerAction,
  emitOwnerDiagnostic,
  nextBackoff,
  readOwnerRecord,
  sleep,
  type CallerKind,
  type OwnerDecision,
} from '@vt/daemon-lifecycle'
import {
  DaemonLaunchTimeout,
  OwnerSpawnCooldownError,
  OwnerWaitTimeoutError,
  UnsafeOwnerError,
} from '../errors.ts'
import { GraphDbClient } from '../GraphDbClient.ts'
import {
  attemptSpawnAndWait,
  gatherEvidence,
  reclaimStaleOwner,
  type SpawnAttemptResult,
} from './spawnCoordinator.ts'
import { resolveCommand } from './runtime.ts'

export type EnsureGraphDaemonOptions = {
  /** Hard deadline for the whole ensure call. Default 5000ms. */
  readonly timeoutMs?: number
  /**
   * Optional override of the daemon command (`<bin> [args] --project-root <path>`).
   * Primarily for tests that point at a fake vt-graphd entrypoint.
   */
  readonly bin?: string
  /**
   * Maximum heartbeat age tolerated before stale-reclaim becomes possible.
   * Default 15s (BF-343 heartbeats every 2s).
   */
  readonly staleHeartbeatMs?: number
  /** Initial poll backoff. Default 50ms. */
  readonly initialBackoffMs?: number
  /** Maximum poll backoff. Default 400ms. */
  readonly maxBackoffMs?: number
  /**
   * Cooldown window persisted to `<project>/.voicetree/graphd.cooldown.json`
   * after a spawn fails. Subsequent ensure calls within this window
   * short-circuit with {@link OwnerSpawnCooldownError} before re-spawning.
   * Default 5000ms.
   */
  readonly spawnCooldownMs?: number
}

export type EnsureGraphDaemonResult = {
  readonly client: GraphDbClient
  readonly port: number
  readonly pid: number
  readonly ownerNonce: string
  /**
   * True when this call spawned the daemon child that won ownership. False
   * when an existing healthy owner was reused or a waited-on in-flight
   * owner finalised before our spawn attempt.
   */
  readonly launched: boolean
}

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_STALE_HEARTBEAT_MS = 15_000
const DEFAULT_INITIAL_BACKOFF_MS = 50
const DEFAULT_MAX_BACKOFF_MS = 400
const DEFAULT_SPAWN_COOLDOWN_MS = 5_000

const inflightByProject = new Map<string, Promise<EnsureGraphDaemonResult>>()

export function clientFor(port: number): GraphDbClient {
  return new GraphDbClient({ baseUrl: `http://127.0.0.1:${port}` })
}

export async function ensureGraphDaemonForProject(
  project: string,
  caller: CallerKind,
  options: EnsureGraphDaemonOptions = {},
): Promise<EnsureGraphDaemonResult> {
  const canonicalProject = resolve(project)
  const existing = inflightByProject.get(canonicalProject)
  if (existing) return existing

  const work = runEnsure(canonicalProject, caller, options).finally(() => {
    inflightByProject.delete(canonicalProject)
  })
  inflightByProject.set(canonicalProject, work)
  return work
}

type EnsureContext = {
  readonly canonicalProject: string
  readonly caller: CallerKind
  /**
   * Per-call UUID carried into every {@link emitOwnerDiagnostic} so
   * listeners can correlate a chain without inferring causality from timing.
   */
  readonly attemptId: string
  readonly options: EnsureGraphDaemonOptions
  readonly deadlineMs: number
  readonly staleHeartbeatMs: number
  readonly initialBackoffMs: number
  readonly maxBackoffMs: number
  readonly spawnCooldownMs: number
}

type LoopOutcome =
  | { readonly kind: 'done'; readonly result: EnsureGraphDaemonResult }
  | { readonly kind: 'continue'; readonly nextBackoff: number }

async function runEnsure(
  canonicalProject: string,
  caller: CallerKind,
  options: EnsureGraphDaemonOptions,
): Promise<EnsureGraphDaemonResult> {
  await mkdir(getProjectDotVoicetreePath(canonicalProject), { recursive: true })
  const ctx = makeEnsureContext(canonicalProject, caller, options)
  let backoff = ctx.initialBackoffMs

  while (Date.now() < ctx.deadlineMs) {
    const evidence = await gatherEvidence(canonicalProject, 'graphd')
    const decision = decideOwnerAction(evidence, {
      nowMs: Date.now(),
      staleHeartbeatMs: ctx.staleHeartbeatMs,
    })
    const outcome = await handleDecision(decision, ctx, backoff)
    if (outcome.kind === 'done') return outcome.result
    backoff = outcome.nextBackoff
  }

  throw await timeoutError(canonicalProject)
}

function makeEnsureContext(
  canonicalProject: string,
  caller: CallerKind,
  options: EnsureGraphDaemonOptions,
): EnsureContext {
  return {
    canonicalProject,
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
 * backoff value. Pulling the dispatch out of {@link runEnsure} keeps the
 * orchestrator a flat while-loop and the per-branch effects each readable
 * on their own.
 *
 * Every transition emits an `OwnerDiagnosticEvent` so subscribers (BF-347
 * `subscribeOwnerDiagnostics`) can observe the full lifecycle.
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
        canonicalProject: ctx.canonicalProject,
        nowMs: Date.now(),
        pid: decision.pid,
        port: decision.port,
        ownerNonce: decision.ownerNonce,
      })
      return {
        kind: 'done',
        result: finaliseReuse(decision.port, decision.pid, decision.ownerNonce),
      }
    }
    case 'wait': {
      emitOwnerDiagnostic({
        kind: 'wait',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalProject: ctx.canonicalProject,
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
        canonicalProject: ctx.canonicalProject,
        nowMs: Date.now(),
        reason: 'no-owner',
      })
      const result = await attemptSpawnAndWait<GraphDbClient>(
        ctx.canonicalProject,
        ctx.caller,
        ctx.attemptId,
        {
          bin: ctx.options.bin,
          daemonKind: 'graphd',
          clientFor,
          resolveCommand,
          initialBackoffMs: ctx.initialBackoffMs,
          maxBackoffMs: ctx.maxBackoffMs,
        },
        ctx.deadlineMs,
        ctx.staleHeartbeatMs,
        ctx.spawnCooldownMs,
      )
      if (result !== null) {
        emitOwnerDiagnostic({
          kind: 'acquired',
          attemptId: ctx.attemptId,
          callerKind: ctx.caller,
          canonicalProject: ctx.canonicalProject,
          nowMs: Date.now(),
          pid: result.pid,
          port: result.port,
          ownerNonce: result.ownerNonce,
        })
        return { kind: 'done', result }
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
        canonicalProject: ctx.canonicalProject,
        nowMs: Date.now(),
        reason: 'stale-reclaim',
      })
      await reclaimStaleOwner(ctx.canonicalProject, 'graphd', decision.staleRecord)
      emitOwnerDiagnostic({
        kind: 'stale-reclaimed',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalProject: ctx.canonicalProject,
        nowMs: Date.now(),
        reason: decision.reason,
        recordedPid: decision.staleRecord.pid,
      })
      return { kind: 'continue', nextBackoff: ctx.initialBackoffMs }
    }
    case 'unsafe-owner':
      throw new UnsafeOwnerError(
        ctx.canonicalProject,
        decision.recordedPid,
        decision.reason,
      )
    case 'cooldown-suppressed': {
      emitOwnerDiagnostic({
        kind: 'cooldown-suppressed',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalProject: ctx.canonicalProject,
        nowMs: Date.now(),
        untilMs: decision.untilMs,
        reason: decision.reason,
      })
      throw new OwnerSpawnCooldownError(
        ctx.canonicalProject,
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
async function timeoutError(canonicalProject: string): Promise<Error> {
  const finalRecord = await readOwnerRecord(canonicalProject, 'graphd')
  if (finalRecord !== null) {
    return new OwnerWaitTimeoutError(canonicalProject, finalRecord.pid)
  }
  return new DaemonLaunchTimeout(
    `vt-graphd ensure for project ${canonicalProject} did not produce an owner before deadline`,
  )
}

function finaliseReuse(
  port: number,
  pid: number,
  ownerNonce: string,
): EnsureGraphDaemonResult {
  return {
    client: clientFor(port),
    port,
    pid,
    ownerNonce,
    launched: false,
  }
}

// Help downstream consumers of the spawn coordinator stay aligned with the
// public result shape without leaking the internal type.
export type { SpawnAttemptResult }
