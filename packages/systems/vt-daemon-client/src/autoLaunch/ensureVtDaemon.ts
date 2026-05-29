/**
 * Public entry for the owner-aware client launcher for the standalone
 * vt-daemon (VTD) controller.
 *
 * `ensureVtDaemonForProject` is the only sanctioned way for a client to
 * obtain a {@link VtDaemonClient} bound to the authoritative VTD owner
 * for a project. Per-project, NOT per-process: one VTD per project per machine,
 * mirroring `ensureGraphDaemonForProject`. Multiple callers for the same
 * project converge on one daemon via the BF-348 in-process single-flight
 * + cross-process spawn lock; multiple callers for DIFFERENT projects each
 * get their own VTD process.
 *
 * This file is a 1:1 mirror of
 * `packages/systems/graph-db-client/src/autoLaunch/ensureGraphDaemon.ts`,
 * differing only in:
 *   1. `clientFor` constructs `VtDaemonClient` (instead of `GraphDbClient`).
 *   2. `EnsureVtDaemonResult` carries `authToken` (graphd has no auth).
 *   3. `resolveCommand` is vtd's (`--project`, not `--project-root`).
 *   4. The cooldown breadcrumb and spawn lock files are vtd-scoped
 *      (`vtd.cooldown.json`, `vtd.spawn.lock`).
 *
 * The orchestrator `attemptSpawnAndWait<VtDaemonClient>` is the SAME
 * orchestrator graphd uses — imported from `@vt/graph-db-client` per
 * BF-369's deep function plan. Duplicating it here would risk the two
 * protocols drifting and silently breaking BF-374's storm-regression
 * coverage.
 */

import {
  boundedDelay,
  DaemonLaunchTimeout,
  decideOwnerAction,
  nextBackoff,
  OwnerSpawnCooldownError,
  OwnerWaitTimeoutError,
  UnsafeOwnerError,
  type CallerKind,
  type OwnerDecision,
} from '@vt/daemon-lifecycle'
import {getProjectDotVoicetreePath} from '@vt/paths'
import type {
  EnsureVtDaemonClient,
  EnsureVtDaemonDeps,
  EnsureVtDaemonOptions,
  EnsureVtDaemonResult,
  EnsureVtDaemonState,
} from './ensureVtDaemonTypes.ts'

export type {
  EnsureVtDaemonOptions,
  EnsureVtDaemonResult,
} from './ensureVtDaemonTypes.ts'

// Cold-start budget. Hot path settles well under 1s; the 30s ceiling absorbs
// CI cold starts where the VTD child brings up tmux, binds HTTP, and persists
// rpc.port before its first health probe answers. Mirrors the request-scope
// default in VtDaemonClient.ts.
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_STALE_HEARTBEAT_MS = 15_000
const DEFAULT_INITIAL_BACKOFF_MS = 50
const DEFAULT_MAX_BACKOFF_MS = 400
const DEFAULT_SPAWN_COOLDOWN_MS = 5_000

export function createEnsureVtDaemonState<TClient extends EnsureVtDaemonClient = EnsureVtDaemonClient>(): EnsureVtDaemonState<TClient> {
  // Per-process single-flight. Distinct from graphd's `inflightByProject` map
  // — VTD-keyed, so a concurrent graphd ensure + vtd ensure for the same
  // project do not block each other. This layer plus the cross-process
  // `vtd.spawn.lock` (acquired inside `attemptSpawnAndWait`) are BOTH
  // required for BF-348 fork-storm prevention; removing either breaks
  // BF-374's storm tests.
  return { inflightByProject: new Map() }
}

export async function ensureVtDaemonForProject<TClient extends EnsureVtDaemonClient = EnsureVtDaemonClient>(
  state: EnsureVtDaemonState<TClient>,
  deps: EnsureVtDaemonDeps<TClient>,
  project: string,
  caller: CallerKind,
  options: EnsureVtDaemonOptions = {},
): Promise<EnsureVtDaemonResult<TClient>> {
  const canonicalProject = deps.resolvePath(project)
  const existing = state.inflightByProject.get(canonicalProject)
  if (existing) return existing

  const work = runEnsure(canonicalProject, caller, options, deps).finally(() => {
    state.inflightByProject.delete(canonicalProject)
  })
  state.inflightByProject.set(canonicalProject, work)
  return work
}

type EnsureContext = {
  readonly canonicalProject: string
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

type LoopOutcome<TClient extends EnsureVtDaemonClient> =
  | { readonly kind: 'done'; readonly result: EnsureVtDaemonResult<TClient> }
  | { readonly kind: 'continue'; readonly nextBackoff: number }

async function runEnsure<TClient extends EnsureVtDaemonClient>(
  canonicalProject: string,
  caller: CallerKind,
  options: EnsureVtDaemonOptions,
  deps: EnsureVtDaemonDeps<TClient>,
): Promise<EnsureVtDaemonResult<TClient>> {
  await deps.mkdir(getProjectDotVoicetreePath(canonicalProject), { recursive: true })
  const ctx = makeEnsureContext(canonicalProject, caller, options, deps)
  let backoff = ctx.initialBackoffMs

  while (deps.now() < ctx.deadlineMs) {
    const evidence = await deps.gatherEvidence(canonicalProject, 'vtd')
    const decision = decideOwnerAction(evidence, {
      nowMs: deps.now(),
      staleHeartbeatMs: ctx.staleHeartbeatMs,
    })
    const outcome = await handleDecision(decision, ctx, backoff, deps)
    if (outcome.kind === 'done') return outcome.result
    backoff = outcome.nextBackoff
  }

  throw await timeoutError(canonicalProject, deps)
}

function makeEnsureContext(
  canonicalProject: string,
  caller: CallerKind,
  options: EnsureVtDaemonOptions,
  deps: EnsureVtDaemonDeps,
): EnsureContext {
  return {
    canonicalProject,
    caller,
    attemptId: deps.newAttemptId(),
    options,
    deadlineMs: deps.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
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
async function handleDecision<TClient extends EnsureVtDaemonClient>(
  decision: OwnerDecision,
  ctx: EnsureContext,
  backoff: number,
  deps: EnsureVtDaemonDeps<TClient>,
): Promise<LoopOutcome<TClient>> {
  switch (decision.kind) {
    case 'reuse': {
      deps.emitOwnerDiagnostic({
        kind: 'reuse',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalProject: ctx.canonicalProject,
        nowMs: deps.now(),
        pid: decision.pid,
        port: decision.port,
        ownerNonce: decision.ownerNonce,
      })
      return {
        kind: 'done',
        result: finaliseReuse(
          ctx.canonicalProject,
          decision.port,
          decision.pid,
          decision.ownerNonce,
          deps,
        ),
      }
    }
    case 'wait': {
      deps.emitOwnerDiagnostic({
        kind: 'wait',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalProject: ctx.canonicalProject,
        nowMs: deps.now(),
        reason: decision.reason,
        recordedPid: decision.recordedPid,
        recordedPort: decision.recordedPort,
      })
      return waitAndContinue(ctx, backoff, deps)
    }
    case 'claim': {
      deps.emitOwnerDiagnostic({
        kind: 'claim-attempt',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalProject: ctx.canonicalProject,
        nowMs: deps.now(),
        reason: 'no-owner',
      })
      const spawnResult = await deps.attemptSpawnAndWait<TClient>(
        ctx.canonicalProject,
        ctx.caller,
        ctx.attemptId,
        {
          bin: ctx.options.bin,
          daemonKind: 'vtd',
          clientFor: (port) => deps.clientFor(port, ctx.canonicalProject),
          resolveCommand: deps.resolveCommand,
          initialBackoffMs: ctx.initialBackoffMs,
          maxBackoffMs: ctx.maxBackoffMs,
        },
        ctx.deadlineMs,
        ctx.staleHeartbeatMs,
        ctx.spawnCooldownMs,
      )
      if (spawnResult !== null) {
        deps.emitOwnerDiagnostic({
          kind: 'acquired',
          attemptId: ctx.attemptId,
          callerKind: ctx.caller,
          canonicalProject: ctx.canonicalProject,
          nowMs: deps.now(),
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
      return waitAndContinue(ctx, backoff, deps)
    }
    case 'stale-reclaim': {
      deps.emitOwnerDiagnostic({
        kind: 'claim-attempt',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalProject: ctx.canonicalProject,
        nowMs: deps.now(),
        reason: 'stale-reclaim',
      })
      await deps.reclaimStaleOwner(ctx.canonicalProject, 'vtd', decision.staleRecord)
      deps.emitOwnerDiagnostic({
        kind: 'stale-reclaimed',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalProject: ctx.canonicalProject,
        nowMs: deps.now(),
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
      deps.emitOwnerDiagnostic({
        kind: 'cooldown-suppressed',
        attemptId: ctx.attemptId,
        callerKind: ctx.caller,
        canonicalProject: ctx.canonicalProject,
        nowMs: deps.now(),
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

async function waitAndContinue<TClient extends EnsureVtDaemonClient>(
  ctx: EnsureContext,
  backoff: number,
  deps: EnsureVtDaemonDeps<TClient>,
): Promise<LoopOutcome<TClient>> {
  await deps.sleep(boundedDelay(backoff, ctx.deadlineMs))
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
async function timeoutError(canonicalProject: string, deps: EnsureVtDaemonDeps): Promise<Error> {
  const finalRecord = await deps.readOwnerRecord(canonicalProject, 'vtd')
  if (finalRecord !== null) {
    return new OwnerWaitTimeoutError(canonicalProject, finalRecord.pid)
  }
  return new DaemonLaunchTimeout(
    `vt-daemon ensure for project ${canonicalProject} did not produce an owner before deadline`,
  )
}

function finaliseReuse<TClient extends EnsureVtDaemonClient>(
  canonicalProject: string,
  port: number,
  pid: number,
  ownerNonce: string,
  deps: EnsureVtDaemonDeps<TClient>,
): EnsureVtDaemonResult<TClient> {
  const client = deps.clientFor(port, canonicalProject)
  return {
    client,
    port,
    pid,
    ownerNonce,
    authToken: client.authToken,
    launched: false,
  }
}
