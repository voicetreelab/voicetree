/**
 * Sanity layer over BF-369's daemonKind generalisation, viewed from the VTD
 * side.
 *
 * The decision rule is daemon-agnostic — it consumes `OwnerEvidence` and
 * emits one of six discriminants. These tests assert that when the rule is
 * fed a VTD-shaped owner record and a VTD-shaped `/health` probe, the
 * decision falls out correctly; and when the probe carries a foreign
 * identity (e.g. a graphd-shaped nonce), the rule surfaces
 * `unsafe-owner: health-identity-mismatch` exactly as it would for graphd.
 *
 * Co-located here instead of in `@vt/daemon-lifecycle` because it is a
 * smoke-check that the generalised primitives are consumed correctly from
 * the VTD side; the rule's own pure tests live in daemon-lifecycle.
 */

import { describe, expect, test } from 'vitest'
import {
    decideOwnerAction,
    type OwnerDecisionPolicy,
    type OwnerEvidence,
    type OwnerRecord,
} from '@vt/daemon-lifecycle'
import { VTD_CONTRACT_VERSION } from '../../contract.ts'

const NOW_MS = 1_700_000_000_000

const VTD_RECORD: OwnerRecord = {
    schemaVersion: 1,
    daemonKind: 'vtd',
    canonicalProject: '/tmp/some-project',
    pid: 12345,
    ppid: 1,
    port: 40000,
    ownerNonce: 'vtd-nonce',
    startedAtMs: NOW_MS - 1_000,
    heartbeatAtMs: NOW_MS - 100,
    callerKind: 'test',
    contractVersion: VTD_CONTRACT_VERSION,
    commandFingerprint: {
        executable: '/usr/bin/node',
        args: ['vtd'],
    },
}

const POLICY: OwnerDecisionPolicy = {
    nowMs: NOW_MS,
    staleHeartbeatMs: 10_000,
}

describe('decideOwnerAction (VTD discrimination smoke)', () => {
    test('VTD record + verified VTD probe (matching nonce + project + port) → reuse', () => {
        const evidence: OwnerEvidence = {
            record: VTD_RECORD,
            recordedPidLiveness: 'alive',
            health: {
                kind: 'verified',
                canonicalProject: VTD_RECORD.canonicalProject,
                ownerNonce: VTD_RECORD.ownerNonce,
                pid: VTD_RECORD.pid,
                port: VTD_RECORD.port!,
            },
            commandFingerprintMatch: 'match',
            cooldown: null,
        }
        const decision = decideOwnerAction(evidence, POLICY)
        expect(decision.kind).toBe('reuse')
        if (decision.kind === 'reuse') {
            expect(decision.ownerNonce).toBe(VTD_RECORD.ownerNonce)
            expect(decision.port).toBe(VTD_RECORD.port)
        }
    })

    test('VTD record + verified probe with FOREIGN nonce (e.g. graphd) → unsafe-owner: health-identity-mismatch', () => {
        const evidence: OwnerEvidence = {
            record: VTD_RECORD,
            recordedPidLiveness: 'alive',
            health: {
                kind: 'verified',
                canonicalProject: VTD_RECORD.canonicalProject,
                ownerNonce: 'graphd-nonce-not-ours',
                pid: VTD_RECORD.pid,
                port: VTD_RECORD.port!,
            },
            commandFingerprintMatch: 'match',
            cooldown: null,
        }
        const decision = decideOwnerAction(evidence, POLICY)
        expect(decision.kind).toBe('unsafe-owner')
        if (decision.kind === 'unsafe-owner') {
            expect(decision.reason).toBe('health-identity-mismatch')
            expect(decision.recordedPid).toBe(VTD_RECORD.pid)
        }
    })

    test('VTD record + mismatch probe → unsafe-owner: health-identity-mismatch (without daemonKind branching)', () => {
        const evidence: OwnerEvidence = {
            record: VTD_RECORD,
            recordedPidLiveness: 'alive',
            health: {
                kind: 'mismatch',
                observedCanonicalProject: VTD_RECORD.canonicalProject,
                observedOwnerNonce: 'something-else',
            },
            commandFingerprintMatch: 'match',
            cooldown: null,
        }
        const decision = decideOwnerAction(evidence, POLICY)
        expect(decision.kind).toBe('unsafe-owner')
    })

    test('no VTD record + no cooldown → claim', () => {
        const evidence: OwnerEvidence = {
            record: null,
            recordedPidLiveness: 'unknown',
            health: { kind: 'unprobed' },
            commandFingerprintMatch: 'unknown',
            cooldown: null,
        }
        const decision = decideOwnerAction(evidence, POLICY)
        expect(decision.kind).toBe('claim')
    })

    test('VTD record + unreachable probe + fresh heartbeat → wait', () => {
        const evidence: OwnerEvidence = {
            record: VTD_RECORD,
            recordedPidLiveness: 'alive',
            health: { kind: 'unreachable' },
            commandFingerprintMatch: 'unknown',
            cooldown: null,
        }
        const decision = decideOwnerAction(evidence, POLICY)
        expect(decision.kind).toBe('wait')
    })
})
