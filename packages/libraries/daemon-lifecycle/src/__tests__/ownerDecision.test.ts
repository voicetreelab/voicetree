import { describe, expect, test } from 'vitest'

import type { CommandFingerprint, OwnerRecord } from '@vt/graph-db-protocol'
import {
  decideOwnerAction,
  type Cooldown,
  type CommandFingerprintMatch,
  type HealthProbeResult,
  type OwnerDecisionPolicy,
  type OwnerEvidence,
  type ProcessLiveness,
} from '../ownerDecision.ts'

const PROJECT = '/project'

function fingerprint(
  overrides: Partial<CommandFingerprint> = {},
): CommandFingerprint {
  return {
    executable: '/usr/local/bin/node',
    args: ['vt-graphd', '--project-root', PROJECT],
    ...overrides,
  }
}

function record(overrides: Partial<OwnerRecord> = {}): OwnerRecord {
  return {
    schemaVersion: 1,
    daemonKind: 'graphd',
    canonicalProject: PROJECT,
    pid: 4242,
    ppid: 1,
    port: 65123,
    ownerNonce: 'nonce-abc',
    startedAtMs: 1_000_000,
    heartbeatAtMs: 1_000_500,
    callerKind: 'electron',
    contractVersion: '0.2.0',
    commandFingerprint: fingerprint(),
    ...overrides,
  }
}

function verifiedHealth(
  overrides: Partial<Extract<HealthProbeResult, { kind: 'verified' }>> = {},
): HealthProbeResult {
  return {
    kind: 'verified',
    canonicalProject: PROJECT,
    ownerNonce: 'nonce-abc',
    pid: 4242,
    port: 65123,
    ...overrides,
  }
}

function evidence(
  overrides: Partial<OwnerEvidence> = {},
): OwnerEvidence {
  return {
    record: record(),
    recordedPidLiveness: 'alive' as ProcessLiveness,
    health: verifiedHealth(),
    commandFingerprintMatch: 'match' as CommandFingerprintMatch,
    cooldown: null,
    ...overrides,
  }
}

function policy(
  overrides: Partial<OwnerDecisionPolicy> = {},
): OwnerDecisionPolicy {
  return {
    nowMs: 1_000_600,
    staleHeartbeatMs: 15_000,
    ...overrides,
  }
}

describe('decideOwnerAction — reuse', () => {
  test('reuses when health verifies the recorded owner identity', () => {
    expect(decideOwnerAction(evidence(), policy())).toEqual({
      kind: 'reuse',
      port: 65123,
      pid: 4242,
      ownerNonce: 'nonce-abc',
    })
  })

  test('reuses even when a cooldown is active (reuse is not a spawn)', () => {
    const cooldown: Cooldown = { untilMs: 9_999_999, reason: 'launch-failed' }
    expect(
      decideOwnerAction(evidence({ cooldown }), policy()).kind,
    ).toBe('reuse')
  })

  test('reuses when record port is null but health confirms a verified port', () => {
    // After a claim-before-spawn record is upgraded with port info from
    // /health, the discovered identity is authoritative.
    const e = evidence({
      record: record({ port: null }),
      health: verifiedHealth({ port: 65999 }),
    })
    expect(decideOwnerAction(e, policy())).toEqual({
      kind: 'reuse',
      port: 65999,
      pid: 4242,
      ownerNonce: 'nonce-abc',
    })
  })
})

describe('decideOwnerAction — claim', () => {
  test('claims when no owner record exists', () => {
    expect(
      decideOwnerAction(evidence({ record: null }), policy()),
    ).toEqual({ kind: 'claim', reason: 'no-owner' })
  })

  test('suppresses claim while a cooldown is active', () => {
    const cooldown: Cooldown = { untilMs: 1_001_000, reason: 'launch-failed' }
    const e = evidence({ record: null, cooldown })
    const result = decideOwnerAction(e, policy({ nowMs: 1_000_600 }))
    expect(result).toEqual({
      kind: 'cooldown-suppressed',
      untilMs: 1_001_000,
      reason: 'launch-failed',
      suppressed: { kind: 'claim', reason: 'no-owner' },
    })
  })

  test('claim proceeds once cooldown has expired', () => {
    const cooldown: Cooldown = { untilMs: 1_000_000, reason: 'launch-failed' }
    const e = evidence({ record: null, cooldown })
    expect(
      decideOwnerAction(e, policy({ nowMs: 1_000_500 })).kind,
    ).toBe('claim')
  })
})

describe('decideOwnerAction — stale-reclaim', () => {
  test('reclaims when recorded pid is dead', () => {
    const r = record()
    const e = evidence({
      record: r,
      recordedPidLiveness: 'dead',
      health: { kind: 'unreachable' },
      commandFingerprintMatch: 'unknown',
    })
    expect(decideOwnerAction(e, policy())).toEqual({
      kind: 'stale-reclaim',
      reason: 'dead-pid',
      staleRecord: r,
    })
  })

  test('reclaims after stale heartbeat when fingerprint positively matches', () => {
    const r = record({ heartbeatAtMs: 0 })
    const e = evidence({
      record: r,
      recordedPidLiveness: 'alive',
      health: { kind: 'unreachable' },
      commandFingerprintMatch: 'match',
    })
    expect(
      decideOwnerAction(e, policy({ nowMs: 1_000_000, staleHeartbeatMs: 15_000 })),
    ).toEqual({
      kind: 'stale-reclaim',
      reason: 'stale-heartbeat',
      staleRecord: r,
    })
  })

  test('cooldown suppresses dead-pid reclaim', () => {
    const r = record()
    const cooldown: Cooldown = { untilMs: 1_001_000, reason: 'launch-failed' }
    const e = evidence({
      record: r,
      recordedPidLiveness: 'dead',
      health: { kind: 'unreachable' },
      commandFingerprintMatch: 'unknown',
      cooldown,
    })
    const result = decideOwnerAction(e, policy({ nowMs: 1_000_700 }))
    expect(result).toEqual({
      kind: 'cooldown-suppressed',
      untilMs: 1_001_000,
      reason: 'launch-failed',
      suppressed: {
        kind: 'stale-reclaim',
        reason: 'dead-pid',
        staleRecord: r,
      },
    })
  })
})

describe('decideOwnerAction — unsafe-owner', () => {
  test('refuses to act when /health reports a different project', () => {
    const e = evidence({
      health: {
        kind: 'mismatch',
        observedCanonicalProject: '/other-project',
        observedOwnerNonce: 'nonce-zzz',
      },
    })
    expect(decideOwnerAction(e, policy())).toEqual({
      kind: 'unsafe-owner',
      reason: 'health-identity-mismatch',
      recordedPid: 4242,
    })
  })

  test('refuses to act when /health verifies a different owner nonce', () => {
    const e = evidence({
      health: verifiedHealth({ ownerNonce: 'nonce-other' }),
    })
    expect(decideOwnerAction(e, policy())).toEqual({
      kind: 'unsafe-owner',
      reason: 'health-identity-mismatch',
      recordedPid: 4242,
    })
  })

  test('refuses to reclaim when stale heartbeat coexists with fingerprint mismatch', () => {
    const e = evidence({
      record: record({ heartbeatAtMs: 0 }),
      recordedPidLiveness: 'alive',
      health: { kind: 'unreachable' },
      commandFingerprintMatch: 'mismatch',
    })
    expect(
      decideOwnerAction(
        e,
        policy({ nowMs: 1_000_000, staleHeartbeatMs: 15_000 }),
      ),
    ).toEqual({
      kind: 'unsafe-owner',
      reason: 'fingerprint-mismatch',
      recordedPid: 4242,
    })
  })

  test('refuses to reclaim when stale heartbeat has unknown fingerprint', () => {
    const e = evidence({
      record: record({ heartbeatAtMs: 0 }),
      recordedPidLiveness: 'unknown',
      health: { kind: 'unreachable' },
      commandFingerprintMatch: 'unknown',
    })
    expect(
      decideOwnerAction(
        e,
        policy({ nowMs: 1_000_000, staleHeartbeatMs: 15_000 }),
      ),
    ).toEqual({
      kind: 'unsafe-owner',
      reason: 'fingerprint-unknown-stale',
      recordedPid: 4242,
    })
  })
})

describe('decideOwnerAction — wait', () => {
  test('waits when record has no port yet (claim-before-spawn)', () => {
    const r = record({ port: null })
    const e = evidence({
      record: r,
      recordedPidLiveness: 'alive',
      health: { kind: 'unprobed' },
      commandFingerprintMatch: 'unknown',
    })
    expect(decideOwnerAction(e, policy())).toEqual({
      kind: 'wait',
      reason: 'owner-starting',
      recordedPid: 4242,
      recordedPort: null,
    })
  })

  test('waits when port exists but is not yet healthy and heartbeat is fresh', () => {
    const e = evidence({
      health: { kind: 'unreachable' },
      commandFingerprintMatch: 'unknown',
    })
    expect(decideOwnerAction(e, policy())).toEqual({
      kind: 'wait',
      reason: 'owner-not-ready',
      recordedPid: 4242,
      recordedPort: 65123,
    })
  })

  test('treats unknown pid liveness with fresh heartbeat as wait, not reclaim', () => {
    // A non-decisive kill(pid,0) error (e.g. EPERM under sandboxed
    // environments) must NOT escalate to stale-reclaim while the owner
    // record is still actively heartbeating.
    const e = evidence({
      recordedPidLiveness: 'unknown',
      health: { kind: 'unreachable' },
      commandFingerprintMatch: 'unknown',
    })
    expect(decideOwnerAction(e, policy()).kind).toBe('wait')
  })
})

describe('decideOwnerAction — invariants', () => {
  test('reuse takes priority over a stale heartbeat (verified health beats clock)', () => {
    const r = record({ heartbeatAtMs: 0 })
    const e = evidence({
      record: r,
      recordedPidLiveness: 'alive',
      health: verifiedHealth(),
      commandFingerprintMatch: 'match',
    })
    expect(
      decideOwnerAction(
        e,
        policy({ nowMs: 9_999_999, staleHeartbeatMs: 15_000 }),
      ).kind,
    ).toBe('reuse')
  })

  test('unsafe-owner takes priority over cooldown (no spawn would happen anyway)', () => {
    const cooldown: Cooldown = { untilMs: 9_999_999, reason: 'launch-failed' }
    const e = evidence({
      health: verifiedHealth({ ownerNonce: 'nonce-other' }),
      cooldown,
    })
    expect(decideOwnerAction(e, policy()).kind).toBe('unsafe-owner')
  })

  test('decision is deterministic for the same evidence', () => {
    const e = evidence()
    const p = policy()
    expect(decideOwnerAction(e, p)).toEqual(decideOwnerAction(e, p))
  })
})
