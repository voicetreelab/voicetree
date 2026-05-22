/**
 * Public entry for the BF-344 owner-aware client launcher.
 *
 * `ensureGraphDaemonForVault` is the only sanctioned way for the client to
 * obtain a {@link GraphDbClient} bound to the authoritative vt-graphd owner
 * for a vault. It coordinates discovery, waiting, claiming, spawning,
 * reclamation, and cooldown suppression by wrapping pure {@link
 * decideOwnerAction} with the impure IO adapters in this directory.
 *
 * Functional shape: one deep, narrow public function backed by composed
 * smaller adapters (`readOwnerRecord`, `probeOwnerHealth`,
 * `readProcessLiveness`, `readCommandFingerprintMatch`, `acquireSpawnLock`,
 * `spawn`). All filesystem, process, HTTP, and clock effects live at the
 * adapter boundary; the orchestrator only sequences them.
 *
 * The function is safe to call concurrently from the same Node process for
 * the same vault — an in-process single-flight cache coalesces concurrent
 * callers into one work-loop. Cross-process concurrency is serialised via
 * the {@link acquireSpawnLock} lock so 100 callers across 100 processes
 * still produce exactly one vt-graphd spawn.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CallerKind, OwnerRecord } from './types.ts'
import { GraphDbClient } from '../GraphDbClient.ts'
import {
  DaemonLaunchTimeout,
  OwnerSpawnCooldownError,
  OwnerWaitTimeoutError,
  UnsafeOwnerError,
} from '../errors.ts'
import { resolveCommand, type CommandSpec } from './runtime.ts'
import {
  decideOwnerAction,
  type OwnerDecision,
  type OwnerEvidence,
} from './ownerDecision.ts'
import { probeOwnerHealth } from './healthIdentityProbe.ts'
import { readOwnerRecord, deleteOwnerRecord } from './ownerRecordIo.ts'
import {
  readCommandFingerprintMatch,
  readProcessLiveness,
} from './processLiveness.ts'
import { acquireSpawnLock } from './spawnLock.ts'

export type EnsureGraphDaemonOptions = {
  /** Hard deadline for the whole ensure call. Default 5000ms. */
  readonly timeoutMs?: number
  /**
   * Optional override of the daemon command (`<bin> [args] --vault <path>`).
   * Forwarded to {@link resolveCommand}. Primarily for tests that point at
   * a fake vt-graphd entrypoint.
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

const inflightByVault = new Map<string, Promise<EnsureGraphDaemonResult>>()

export async function ensureGraphDaemonForVault(
  vault: string,
  caller: CallerKind,
  options: EnsureGraphDaemonOptions = {},
): Promise<EnsureGraphDaemonResult> {
  const canonicalVaultPath = resolve(vault)
  const existing = inflightByVault.get(canonicalVaultPath)
  if (existing) return existing

  const work = runEnsure(canonicalVaultPath, caller, options).finally(() => {
    inflightByVault.delete(canonicalVaultPath)
  })
  inflightByVault.set(canonicalVaultPath, work)
  return work
}

type EnsureContext = {
  readonly canonicalVaultPath: string
  readonly caller: CallerKind
  readonly options: EnsureGraphDaemonOptions
  readonly deadlineMs: number
  readonly staleHeartbeatMs: number
  readonly initialBackoffMs: number
  readonly maxBackoffMs: number
}

type LoopOutcome =
  | { readonly kind: 'done'; readonly result: EnsureGraphDaemonResult }
  | { readonly kind: 'continue'; readonly nextBackoff: number }

async function runEnsure(
  canonicalVaultPath: string,
  caller: CallerKind,
  options: EnsureGraphDaemonOptions,
): Promise<EnsureGraphDaemonResult> {
  await mkdir(`${canonicalVaultPath}/.voicetree`, { recursive: true })
  const ctx = makeEnsureContext(canonicalVaultPath, caller, options)
  let backoff = ctx.initialBackoffMs

  while (Date.now() < ctx.deadlineMs) {
    const evidence = await gatherEvidence(canonicalVaultPath)
    const decision = decideOwnerAction(evidence, {
      nowMs: Date.now(),
      staleHeartbeatMs: ctx.staleHeartbeatMs,
    })
    const outcome = await handleDecision(decision, ctx, backoff)
    if (outcome.kind === 'done') return outcome.result
    backoff = outcome.nextBackoff
  }

  throw await timeoutError(canonicalVaultPath)
}

function makeEnsureContext(
  canonicalVaultPath: string,
  caller: CallerKind,
  options: EnsureGraphDaemonOptions,
): EnsureContext {
  return {
    canonicalVaultPath,
    caller,
    options,
    deadlineMs: Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    staleHeartbeatMs:
      options.staleHeartbeatMs ?? DEFAULT_STALE_HEARTBEAT_MS,
    initialBackoffMs:
      options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS,
    maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
  }
}

/**
 * Map one {@link OwnerDecision} to its loop effect. Each branch is either
 * a terminal outcome (return / throw) or a continuation with the next
 * backoff value. Pulling the dispatch out of {@link runEnsure} keeps the
 * orchestrator a flat while-loop and the per-branch effects each readable
 * on their own.
 */
async function handleDecision(
  decision: OwnerDecision,
  ctx: EnsureContext,
  backoff: number,
): Promise<LoopOutcome> {
  switch (decision.kind) {
    case 'reuse':
      return {
        kind: 'done',
        result: {
          client: clientFor(decision.port),
          port: decision.port,
          pid: decision.pid,
          ownerNonce: decision.ownerNonce,
          launched: false,
        },
      }
    case 'wait':
      return waitAndContinue(ctx, backoff)
    case 'claim': {
      const launched = await attemptSpawnAndWait(
        ctx.canonicalVaultPath,
        ctx.caller,
        ctx.options,
        ctx.deadlineMs,
        ctx.staleHeartbeatMs,
      )
      if (launched !== null) return { kind: 'done', result: launched }
      // Lost the spawn lock or another caller's claim raced ahead; loop
      // back to discovery and reuse/wait on their owner.
      return waitAndContinue(ctx, backoff)
    }
    case 'stale-reclaim':
      await reclaimStaleOwner(ctx.canonicalVaultPath, decision.staleRecord)
      return { kind: 'continue', nextBackoff: ctx.initialBackoffMs }
    case 'unsafe-owner':
      throw new UnsafeOwnerError(
        ctx.canonicalVaultPath,
        decision.recordedPid,
        decision.reason,
      )
    case 'cooldown-suppressed':
      throw new OwnerSpawnCooldownError(
        ctx.canonicalVaultPath,
        decision.untilMs,
        decision.reason,
      )
  }
}

async function waitAndContinue(
  ctx: EnsureContext,
  backoff: number,
): Promise<LoopOutcome> {
  await sleep(boundedDelay(backoff, ctx.deadlineMs))
  return { kind: 'continue', nextBackoff: nextBackoff(backoff, ctx.maxBackoffMs) }
}

/**
 * Decide which timeout shape to throw when the work-loop deadline expires.
 * Distinguishes "we were waiting on an in-flight owner" (record on disk)
 * from "we never even got a record" (no owner ever materialised).
 */
async function timeoutError(canonicalVaultPath: string): Promise<Error> {
  const finalRecord = await readOwnerRecord(canonicalVaultPath)
  if (finalRecord !== null) {
    return new OwnerWaitTimeoutError(canonicalVaultPath, finalRecord.pid)
  }
  return new DaemonLaunchTimeout(
    `vt-graphd ensure for vault ${canonicalVaultPath} did not produce an owner before deadline`,
  )
}

async function gatherEvidence(
  canonicalVaultPath: string,
): Promise<OwnerEvidence> {
  const record = await readOwnerRecord(canonicalVaultPath)
  if (record === null) {
    return {
      record: null,
      recordedPidLiveness: 'unknown',
      health: { kind: 'unprobed' },
      commandFingerprintMatch: 'unknown',
      cooldown: null,
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
    cooldown: null,
  }
}

/**
 * Run the spawn step under the cross-process spawn lock. Returns the
 * resulting handle when this caller spawned (or finalised) the daemon,
 * `null` when the spawn lock is held by another live caller (the work-loop
 * loops back to discovery in that case).
 */
async function attemptSpawnAndWait(
  canonicalVaultPath: string,
  caller: CallerKind,
  options: EnsureGraphDaemonOptions,
  deadlineMs: number,
  staleHeartbeatMs: number,
): Promise<EnsureGraphDaemonResult | null> {
  const acquisition = await acquireSpawnLock(canonicalVaultPath, process.pid)
  if (acquisition.kind === 'held') {
    return null
  }

  try {
    // Another caller may have produced a healthy owner record between our
    // last discovery scan and acquiring the spawn lock. Honour it.
    const preSpawnRecord = await readOwnerRecord(canonicalVaultPath)
    if (preSpawnRecord !== null && preSpawnRecord.port !== null) {
      const reuseResult = await tryReuseExistingOwner(
        canonicalVaultPath,
        preSpawnRecord,
      )
      if (reuseResult !== null) return reuseResult
    }

    const command = resolveCommand(canonicalVaultPath, options.bin)
    const spawnedPid = spawnDaemon(command, caller)
    return await waitForDaemonHealth(
      canonicalVaultPath,
      spawnedPid,
      deadlineMs,
      staleHeartbeatMs,
      options,
    )
  } finally {
    await acquisition.release()
  }
}

async function tryReuseExistingOwner(
  canonicalVaultPath: string,
  record: OwnerRecord,
): Promise<EnsureGraphDaemonResult | null> {
  if (record.port === null) return null
  const probe = await probeOwnerHealth(record.port)
  if (probe.kind !== 'verified') return null
  if (probe.canonicalVaultPath !== record.canonicalVaultPath) return null
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
  canonicalVaultPath: string,
  spawnedPid: number | null,
  deadlineMs: number,
  staleHeartbeatMs: number,
  options: EnsureGraphDaemonOptions,
): Promise<EnsureGraphDaemonResult> {
  const initialBackoffMs =
    options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
  let backoff = initialBackoffMs

  while (Date.now() < deadlineMs) {
    const evidence = await gatherEvidence(canonicalVaultPath)
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
        canonicalVaultPath,
        decision.recordedPid,
        decision.reason,
      )
    }
    // wait / claim / stale-reclaim during the spawn window all reduce to
    // "the daemon has not yet finalised its claim". Keep polling.
    await sleep(boundedDelay(backoff, deadlineMs))
    backoff = nextBackoff(backoff, maxBackoffMs)
  }

  throw new DaemonLaunchTimeout(
    `vt-graphd spawn (pid ${spawnedPid ?? 'unknown'}) did not become healthy for vault ${canonicalVaultPath} before deadline`,
  )
}

async function reclaimStaleOwner(
  canonicalVaultPath: string,
  staleRecord: OwnerRecord,
): Promise<void> {
  // Stale reclaim is only ever returned by `decideOwnerAction` after the
  // safe-kill predicates passed (dead pid, OR alive pid with matching
  // command fingerprint). The dead case has nothing to terminate; the
  // alive case is a hung vt-graphd we are authorised to terminate so its
  // owner record can be replaced.
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
  await deleteOwnerRecord(canonicalVaultPath)
}

function clientFor(port: number): GraphDbClient {
  return new GraphDbClient({ baseUrl: `http://127.0.0.1:${port}` })
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

function nextBackoff(current: number, ceiling: number): number {
  return Math.min(current * 2, ceiling)
}

function boundedDelay(backoff: number, deadlineMs: number): number {
  const remaining = deadlineMs - Date.now()
  if (remaining <= 0) return 0
  return Math.min(backoff, remaining)
}
