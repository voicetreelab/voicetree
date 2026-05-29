/**
 * BF-369 daemonKind separation: a single project can host both a 'graphd'
 * and a 'vtd' owner record simultaneously, with independent file paths,
 * nonces, and pids. The decision rule routes a cross-kind record to
 * unsafe-owner so a stale graphd record can't be read as a vtd record
 * after the on-disk schema is renamed.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  createInitialRecord,
  decideOwnerAction,
  ownerRecordFile,
  readOwnerRecord,
  tryAtomicCreate,
  type OwnerEvidence,
} from '../index.ts'

let project: string

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'vt-daemon-lifecycle-kind-'))
  await mkdir(join(project, '.voicetree'), { recursive: true })
})

afterEach(async () => {
  await rm(project, { recursive: true, force: true })
})

describe('OwnerRecord daemonKind separation (BF-369)', () => {
  test('concurrent atomic creates for graphd and vtd on the same project BOTH succeed with distinct on-disk files and nonces', async () => {
    const fingerprint = { executable: '/usr/local/bin/node', args: ['--project-root', project] }
    const now = 1_700_000_000_000
    const graphdRecord = createInitialRecord({
      daemonKind: 'graphd',
      canonicalProject: project,
      pid: 1001,
      ppid: 1,
      callerKind: 'test',
      contractVersion: '0.2.0',
      commandFingerprint: fingerprint,
      nowMs: now,
    })
    const vtdRecord = createInitialRecord({
      daemonKind: 'vtd',
      canonicalProject: project,
      pid: 2002,
      ppid: 1,
      callerKind: 'test',
      contractVersion: '0.2.0',
      commandFingerprint: fingerprint,
      nowMs: now,
    })

    const graphdPath = ownerRecordFile.pathFor(project, 'graphd')
    const vtdPath = ownerRecordFile.pathFor(project, 'vtd')
    expect(graphdPath).toBe(join(project, '.voicetree', 'graphd.owner.json'))
    expect(vtdPath).toBe(join(project, '.voicetree', 'vtd.owner.json'))
    expect(graphdPath).not.toBe(vtdPath)

    const [graphdOutcome, vtdOutcome] = await Promise.all([
      tryAtomicCreate(graphdPath, graphdRecord),
      tryAtomicCreate(vtdPath, vtdRecord),
    ])
    expect(graphdOutcome.kind).toBe('created')
    expect(vtdOutcome.kind).toBe('created')

    // Both files exist on disk and decode back to records of the right kind.
    const graphdOnDisk = await readOwnerRecord(graphdPath)
    const vtdOnDisk = await readOwnerRecord(vtdPath)
    expect(graphdOnDisk?.daemonKind).toBe('graphd')
    expect(graphdOnDisk?.pid).toBe(1001)
    expect(vtdOnDisk?.daemonKind).toBe('vtd')
    expect(vtdOnDisk?.pid).toBe(2002)
    expect(graphdOnDisk?.ownerNonce).not.toBe(vtdOnDisk?.ownerNonce)

    // And via the (projectDir, daemonKind) overload — readOwnerRecord resolves
    // the right path internally.
    expect(await readOwnerRecord(project, 'graphd')).toEqual(graphdOnDisk)
    expect(await readOwnerRecord(project, 'vtd')).toEqual(vtdOnDisk)

    // Each file's encoded form contains the expected daemonKind discriminant.
    const graphdRaw = await readFile(graphdPath, 'utf8')
    const vtdRaw = await readFile(vtdPath, 'utf8')
    expect(graphdRaw).toContain('"daemonKind": "graphd"')
    expect(vtdRaw).toContain('"daemonKind": "vtd"')
  })

  test('decideOwnerAction returns unsafe-owner when probe identity matches but recorded daemonKind disagrees with policy', () => {
    // A stale graphd record observed at a port now bound by vtd would
    // surface as unsafe-owner because the verified health identity comes
    // from a different daemon (the project path matches but the nonce does
    // not, since per-claim nonces never collide across kinds).
    const graphdRecord = createInitialRecord({
      daemonKind: 'graphd',
      canonicalProject: project,
      pid: 1001,
      ppid: 1,
      callerKind: 'test',
      contractVersion: '0.2.0',
      commandFingerprint: { executable: '/bin/node', args: [] },
      nowMs: 1_700_000_000_000,
      ownerNonce: 'graphd-nonce',
    })
    const evidence: OwnerEvidence = {
      record: { ...graphdRecord, port: 65123 },
      recordedPidLiveness: 'alive',
      health: {
        kind: 'verified',
        canonicalProject: project,
        ownerNonce: 'vtd-nonce',
        pid: 1001,
        port: 65123,
      },
      commandFingerprintMatch: 'match',
      cooldown: null,
    }
    expect(decideOwnerAction(evidence, { nowMs: 1_700_000_000_500, staleHeartbeatMs: 15_000 })).toEqual({
      kind: 'unsafe-owner',
      reason: 'health-identity-mismatch',
      recordedPid: 1001,
    })
  })
})
