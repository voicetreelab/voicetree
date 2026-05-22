/**
 * Public entry for the owner-aware client launcher.
 *
 * `ensureGraphDaemonForVault` is the only sanctioned way for the client to
 * obtain a {@link GraphDbClient} bound to the authoritative vt-graphd owner
 * for a vault. It coordinates discovery, waiting, claiming, spawning,
 * reclamation, and cooldown suppression by wrapping pure {@link
 * decideOwnerAction} with the impure IO adapters in this directory.
 *
 * Functional shape: one deep, narrow public function backed by a pure
 * decision rule (`decideOwnerAction`) and the impure spawn/wait/reclaim
 * helpers in `spawnCoordinator.ts`. The orchestrator only sequences them
 * and emits structured ownership diagnostics (BF-347) at each transition.
 *
 * The function is safe to call concurrently from the same Node process for
 * the same vault — an in-process single-flight cache coalesces concurrent
 * callers into one work-loop. Cross-process concurrency is serialised via
 * the spawn lock so 100 callers across 100 processes still produce exactly
 * one vt-graphd spawn.
 */

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { CallerKind } from '@vt/graph-db-protocol'
import {
  DaemonLaunchTimeout,
  OwnerSpawnCooldownError,
  OwnerWaitTimeoutError,
  UnsafeOwnerError,
} from '../errors.ts'
import { GraphDbClient } from '../GraphDbClient.ts'
import { emitOwnerDiagnostic } from './diagnostics.ts'
import { decideOwnerAction } from './ownerDecision.ts'
import { readOwnerRecord } from './ownerRecordIo.ts'
import {
  attemptSpawnAndWait,
  boundedDelay,
  clientFor,
  gatherEvidence,
  nextBackoff,
  reclaimStaleOwner,
  sleep,
  type SpawnAttemptResult,
} from './spawnCoordinator.ts'

export type EnsureGraphDaemonOptions = {
  /** Hard deadline for the whole ensure call. Default 5000ms. */
  readonly timeoutMs?: number
  /**
   * Optional override of the daemon command (`<bin> [args] --vault <path>`).
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
   * Cooldown window persisted to `<vault>/.voicetree/graphd.cooldown.json`
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

async function runEnsure(
  canonicalVaultPath: string,
  caller: CallerKind,
  options: EnsureGraphDaemonOptions,
): Promise<EnsureGraphDaemonResult> {
  await mkdir(`${canonicalVaultPath}/.voicetree`, { recursive: true })
  const attemptId = randomUUID()
  const deadlineMs = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const staleHeartbeatMs =
    options.staleHeartbeatMs ?? DEFAULT_STALE_HEARTBEAT_MS
  const initialBackoffMs =
    options.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
  const spawnCooldownMs =
    options.spawnCooldownMs ?? DEFAULT_SPAWN_COOLDOWN_MS
  let backoff = initialBackoffMs

  while (Date.now() < deadlineMs) {
    const evidence = await gatherEvidence(canonicalVaultPath)
    const decision = decideOwnerAction(evidence, {
      nowMs: Date.now(),
      staleHeartbeatMs,
    })

    switch (decision.kind) {
      case 'reuse': {
        emitOwnerDiagnostic({
          kind: 'reuse',
          attemptId,
          callerKind: caller,
          canonicalVaultPath,
          nowMs: Date.now(),
          pid: decision.pid,
          port: decision.port,
          ownerNonce: decision.ownerNonce,
        })
        return finaliseReuse(decision.port, decision.pid, decision.ownerNonce)
      }

      case 'wait': {
        emitOwnerDiagnostic({
          kind: 'wait',
          attemptId,
          callerKind: caller,
          canonicalVaultPath,
          nowMs: Date.now(),
          reason: decision.reason,
          recordedPid: decision.recordedPid,
          recordedPort: decision.recordedPort,
        })
        await sleep(boundedDelay(backoff, deadlineMs))
        backoff = nextBackoff(backoff, maxBackoffMs)
        continue
      }

      case 'claim': {
        emitOwnerDiagnostic({
          kind: 'claim-attempt',
          attemptId,
          callerKind: caller,
          canonicalVaultPath,
          nowMs: Date.now(),
          reason: 'no-owner',
        })
        const result = await attemptSpawnAndWait(
          canonicalVaultPath,
          caller,
          attemptId,
          { bin: options.bin, initialBackoffMs, maxBackoffMs },
          deadlineMs,
          staleHeartbeatMs,
          spawnCooldownMs,
        )
        if (result !== null) {
          emitOwnerDiagnostic({
            kind: 'acquired',
            attemptId,
            callerKind: caller,
            canonicalVaultPath,
            nowMs: Date.now(),
            pid: result.pid,
            port: result.port,
            ownerNonce: result.ownerNonce,
          })
          return result
        }
        // Lost the spawn lock or another caller's claim raced ahead;
        // loop back to discovery and reuse/wait on their owner.
        await sleep(boundedDelay(backoff, deadlineMs))
        backoff = nextBackoff(backoff, maxBackoffMs)
        continue
      }

      case 'stale-reclaim': {
        emitOwnerDiagnostic({
          kind: 'claim-attempt',
          attemptId,
          callerKind: caller,
          canonicalVaultPath,
          nowMs: Date.now(),
          reason: 'stale-reclaim',
        })
        await reclaimStaleOwner(canonicalVaultPath, decision.staleRecord)
        emitOwnerDiagnostic({
          kind: 'stale-reclaimed',
          attemptId,
          callerKind: caller,
          canonicalVaultPath,
          nowMs: Date.now(),
          reason: decision.reason,
          recordedPid: decision.staleRecord.pid,
        })
        backoff = initialBackoffMs
        continue
      }

      case 'unsafe-owner': {
        throw new UnsafeOwnerError(
          canonicalVaultPath,
          decision.recordedPid,
          decision.reason,
        )
      }

      case 'cooldown-suppressed': {
        emitOwnerDiagnostic({
          kind: 'cooldown-suppressed',
          attemptId,
          callerKind: caller,
          canonicalVaultPath,
          nowMs: Date.now(),
          untilMs: decision.untilMs,
          reason: decision.reason,
        })
        throw new OwnerSpawnCooldownError(
          canonicalVaultPath,
          decision.untilMs,
          decision.reason,
        )
      }
    }
  }

  // Decision loop ran out of time. Distinguish "we were waiting on an
  // in-flight owner" from "we never even got a record".
  const finalRecord = await readOwnerRecord(canonicalVaultPath)
  if (finalRecord !== null) {
    throw new OwnerWaitTimeoutError(canonicalVaultPath, finalRecord.pid)
  }
  throw new DaemonLaunchTimeout(
    `vt-graphd ensure for vault ${canonicalVaultPath} did not produce an owner before deadline`,
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
