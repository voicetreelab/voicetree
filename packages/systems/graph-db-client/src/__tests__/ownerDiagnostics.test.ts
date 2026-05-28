/**
 * BF-347 black-box: ownership lifecycle emits structured diagnostic events
 * for the full taxonomy required by the spec. Asserts on the events
 * captured by a subscriber — no internal mocks, no toHaveBeenCalledWith.
 */

import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { OwnerDiagnosticEvent } from '@vt/graph-db-protocol'
import {
  ensureGraphDaemonForVault,
  subscribeOwnerDiagnostics,
} from '../index.ts'

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
)
const FAKE_BIN = join(FIXTURE_DIR, 'fake-vt-graphd.mjs')
const FAKE_BIN_COMMAND = `${process.execPath} ${FAKE_BIN}`

let vault: string
let spawnedPids: number[]
let captured: OwnerDiagnosticEvent[]
let unsubscribe: (() => void) | null = null

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'vt-graphd-bf347-diag-'))
  await mkdir(join(vault, '.voicetree'), { recursive: true })
  spawnedPids = []
  captured = []
  unsubscribe = subscribeOwnerDiagnostics((event) => captured.push(event))
})

afterEach(async () => {
  unsubscribe?.()
  unsubscribe = null
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  await rm(vault, { recursive: true, force: true })
})

describe('OwnerDiagnosticEvent emission (BF-347)', () => {
  test('cold-start emits the claim → spawn-started → spawn-ready → acquired sequence with required fields', async () => {
    const result = await ensureGraphDaemonForVault(vault, 'cli', {
      bin: FAKE_BIN_COMMAND,
      timeoutMs: 5_000,
    })
    spawnedPids.push(result.pid)

    const kinds = captured.map((event) => event.kind)
    expect(kinds).toContain('claim-attempt')
    expect(kinds).toContain('spawn-started')
    expect(kinds).toContain('spawn-ready')
    expect(kinds).toContain('acquired')

    // Order matters: claim-attempt before spawn-started before spawn-ready
    // before acquired. acquired must come last because the orchestrator
    // emits it only after the spawn resolves.
    const claimIdx = kinds.indexOf('claim-attempt')
    const startIdx = kinds.indexOf('spawn-started')
    const readyIdx = kinds.indexOf('spawn-ready')
    const acquiredIdx = kinds.indexOf('acquired')
    expect(claimIdx).toBeLessThan(startIdx)
    expect(startIdx).toBeLessThan(readyIdx)
    expect(readyIdx).toBeLessThan(acquiredIdx)

    // Every event carries the spec's required identity fields.
    const canonicalVault = resolve(vault)
    for (const event of captured) {
      expect(event.callerKind).toBe('cli')
      expect(event.canonicalVault).toBe(canonicalVault)
      expect(typeof event.attemptId).toBe('string')
      expect(event.attemptId.length).toBeGreaterThan(0)
      expect(Number.isFinite(event.nowMs)).toBe(true)
    }

    // attemptId is stable across one ensure call so listeners can correlate.
    const attemptIds = new Set(captured.map((event) => event.attemptId))
    expect(attemptIds.size).toBe(1)

    // spawn-ready / acquired carry the resolved pid + port + nonce.
    const acquired = captured.find((event) => event.kind === 'acquired')
    expect(acquired).toBeDefined()
    if (acquired && acquired.kind === 'acquired') {
      expect(acquired.pid).toBe(result.pid)
      expect(acquired.port).toBe(result.port)
      expect(acquired.ownerNonce).toBe(result.ownerNonce)
    }
  }, 15_000)

  test('reuse path emits a `reuse` event with pid + port + ownerNonce', async () => {
    // First ensure starts the daemon.
    const first = await ensureGraphDaemonForVault(vault, 'cli', {
      bin: FAKE_BIN_COMMAND,
      timeoutMs: 5_000,
    })
    spawnedPids.push(first.pid)

    // Reset captures to focus on the reuse-path events only.
    captured.length = 0

    // Second ensure should reuse — but the in-process single-flight is
    // already cleared by then, so this is a fresh discovery → reuse.
    const second = await ensureGraphDaemonForVault(vault, 'electron-main', {
      bin: FAKE_BIN_COMMAND,
      timeoutMs: 2_000,
    })
    expect(second.launched).toBe(false)
    expect(second.pid).toBe(first.pid)

    const reuse = captured.find((event) => event.kind === 'reuse')
    expect(reuse).toBeDefined()
    if (reuse && reuse.kind === 'reuse') {
      expect(reuse.pid).toBe(first.pid)
      expect(reuse.port).toBe(first.port)
      expect(reuse.ownerNonce).toBe(first.ownerNonce)
      expect(reuse.callerKind).toBe('electron-main')
    }
  }, 15_000)

  test('listener errors do not destabilise the ownership work loop', async () => {
    // Add a broken listener that throws on every event.
    const noisyUnsub = subscribeOwnerDiagnostics(() => {
      throw new Error('listener failure should be swallowed')
    })

    try {
      const result = await ensureGraphDaemonForVault(vault, 'test', {
        bin: FAKE_BIN_COMMAND,
        timeoutMs: 5_000,
      })
      expect(result.launched).toBe(true)
      spawnedPids.push(result.pid)
    } finally {
      noisyUnsub()
    }
  }, 15_000)
})
