/**
 * Pure decision function for vt-graphd vault ownership.
 *
 * Callers gather observations about the on-disk owner record, recorded pid
 * liveness, health probe identity, command fingerprint match, and any
 * active cooldown breadcrumb. {@link decideOwnerAction} maps those
 * observations to one of the discriminated decisions below. The function
 * is deterministic, free of I/O, and only depends on its inputs — it is
 * the core invariant of the single-owner protocol and is tested as a
 * black box.
 *
 * BF-342: foundation only. Production launcher wiring (Electron, CLI,
 * graph-db-client, server lifecycle) lives in BF-343..BF-348.
 */

import type { OwnerRecord } from '../types.ts'

/**
 * Liveness observation for the recorded owner pid.
 *
 * - `alive`: kill(pid, 0) succeeded.
 * - `dead`: kill(pid, 0) reported ESRCH.
 * - `unknown`: lookup failed with a non-decisive error (e.g. EPERM on
 *   another user's pid). Treated conservatively: never authorize a kill.
 */
export type ProcessLiveness = 'alive' | 'dead' | 'unknown'

/**
 * Command fingerprint comparison between the recorded owner and the live
 * pid the kernel currently holds at that number.
 *
 * - `match`: the live process executable + args match the recorded owner
 *   command fingerprint, so the pid has not been reused.
 * - `mismatch`: the live process is a different program. The pid was
 *   reused or the recorded fingerprint is wrong; we must not kill it.
 * - `unknown`: the caller could not inspect the live command. Treated
 *   conservatively — no kill is authorized.
 */
export type CommandFingerprintMatch = 'match' | 'mismatch' | 'unknown'

/**
 * Result of probing `/health` on the recorded owner port.
 */
export type HealthProbeResult =
  | { readonly kind: 'unprobed' }
  | { readonly kind: 'unreachable' }
  | {
      readonly kind: 'mismatch'
      readonly observedCanonicalProjectRoot: string | null
      readonly observedOwnerNonce: string | null
    }
  | {
      readonly kind: 'verified'
      readonly canonicalVault: string
      readonly ownerNonce: string
      readonly pid: number
      readonly port: number
    }

export type Cooldown = {
  readonly untilMs: number
  readonly reason: string
}

export type OwnerEvidence = {
  readonly record: OwnerRecord | null
  readonly recordedPidLiveness: ProcessLiveness
  readonly health: HealthProbeResult
  readonly commandFingerprintMatch: CommandFingerprintMatch
  readonly cooldown: Cooldown | null
}

export type OwnerDecisionPolicy = {
  readonly nowMs: number
  /**
   * Maximum heartbeat age tolerated before a non-verified owner can be
   * stale-reclaimed. Heartbeat age `nowMs - record.heartbeatAtMs`.
   */
  readonly staleHeartbeatMs: number
}

export type ReuseDecision = {
  readonly kind: 'reuse'
  readonly port: number
  readonly pid: number
  readonly ownerNonce: string
}

export type WaitReason = 'owner-starting' | 'owner-not-ready'

export type WaitDecision = {
  readonly kind: 'wait'
  readonly reason: WaitReason
  readonly recordedPid: number
  readonly recordedPort: number | null
}

export type ClaimReason = 'no-owner'

export type ClaimDecision = {
  readonly kind: 'claim'
  readonly reason: ClaimReason
}

export type StaleReclaimReason = 'dead-pid' | 'stale-heartbeat'

export type StaleReclaimDecision = {
  readonly kind: 'stale-reclaim'
  readonly reason: StaleReclaimReason
  readonly staleRecord: OwnerRecord
}

export type UnsafeOwnerReason =
  | 'health-identity-mismatch'
  | 'fingerprint-mismatch'
  | 'fingerprint-unknown-stale'

export type UnsafeOwnerDecision = {
  readonly kind: 'unsafe-owner'
  readonly reason: UnsafeOwnerReason
  readonly recordedPid: number
}

export type CooldownSuppressedDecision = {
  readonly kind: 'cooldown-suppressed'
  readonly untilMs: number
  readonly reason: string
  /**
   * What the decision would have been without the cooldown. Useful for
   * diagnostics: it tells operators why a spawn was suppressed.
   */
  readonly suppressed: ClaimDecision | StaleReclaimDecision
}

export type OwnerDecision =
  | ReuseDecision
  | WaitDecision
  | ClaimDecision
  | StaleReclaimDecision
  | UnsafeOwnerDecision
  | CooldownSuppressedDecision

/**
 * Decide the next single-owner action for a vault given current evidence.
 *
 * Priority order:
 *  1. Reuse — a verified healthy owner is always usable, even during a
 *     cooldown window. A reuse is not a spawn.
 *  2. Unsafe-owner — health identity mismatch (some other vt-graphd
 *     instance, or another tool, is on the recorded port). Refuses to
 *     reclaim because reclaim could kill an unrelated process.
 *  3. Claim — no record on disk. Suppressed by an active cooldown.
 *  4. Stale-reclaim — recorded pid is dead, or heartbeat is stale and
 *     identity (fingerprint) is positively confirmed. Suppressed by an
 *     active cooldown.
 *  5. Unsafe-owner — heartbeat is stale and identity cannot be confirmed
 *     (mismatch or unknown fingerprint). We refuse to reclaim.
 *  6. Wait — owner is in startup or transient unhealth; heartbeat is
 *     still fresh.
 */
export function decideOwnerAction(
  evidence: OwnerEvidence,
  policy: OwnerDecisionPolicy,
): OwnerDecision {
  const { record, health } = evidence

  if (record === null) {
    return suppressIfCooldown(evidence.cooldown, policy.nowMs, {
      kind: 'claim',
      reason: 'no-owner',
    })
  }

  if (
    health.kind === 'verified' &&
    healthMatchesRecord(health, record)
  ) {
    return {
      kind: 'reuse',
      port: health.port,
      pid: health.pid,
      ownerNonce: health.ownerNonce,
    }
  }

  if (health.kind === 'mismatch' || health.kind === 'verified') {
    return {
      kind: 'unsafe-owner',
      reason: 'health-identity-mismatch',
      recordedPid: record.pid,
    }
  }

  if (evidence.recordedPidLiveness === 'dead') {
    return suppressIfCooldown(evidence.cooldown, policy.nowMs, {
      kind: 'stale-reclaim',
      reason: 'dead-pid',
      staleRecord: record,
    })
  }

  const heartbeatAgeMs = policy.nowMs - record.heartbeatAtMs
  const heartbeatStale = heartbeatAgeMs >= policy.staleHeartbeatMs

  if (heartbeatStale) {
    if (evidence.commandFingerprintMatch === 'mismatch') {
      return {
        kind: 'unsafe-owner',
        reason: 'fingerprint-mismatch',
        recordedPid: record.pid,
      }
    }
    if (evidence.commandFingerprintMatch === 'match') {
      return suppressIfCooldown(evidence.cooldown, policy.nowMs, {
        kind: 'stale-reclaim',
        reason: 'stale-heartbeat',
        staleRecord: record,
      })
    }
    return {
      kind: 'unsafe-owner',
      reason: 'fingerprint-unknown-stale',
      recordedPid: record.pid,
    }
  }

  return {
    kind: 'wait',
    reason: record.port === null ? 'owner-starting' : 'owner-not-ready',
    recordedPid: record.pid,
    recordedPort: record.port,
  }
}

function healthMatchesRecord(
  health: Extract<HealthProbeResult, { kind: 'verified' }>,
  record: OwnerRecord,
): boolean {
  if (health.canonicalVault !== record.canonicalVault) return false
  if (health.ownerNonce !== record.ownerNonce) return false
  if (record.port !== null && health.port !== record.port) return false
  return true
}

function suppressIfCooldown(
  cooldown: Cooldown | null,
  nowMs: number,
  spawnDecision: ClaimDecision | StaleReclaimDecision,
): OwnerDecision {
  if (cooldown === null || nowMs >= cooldown.untilMs) return spawnDecision
  return {
    kind: 'cooldown-suppressed',
    untilMs: cooldown.untilMs,
    reason: cooldown.reason,
    suppressed: spawnDecision,
  }
}
