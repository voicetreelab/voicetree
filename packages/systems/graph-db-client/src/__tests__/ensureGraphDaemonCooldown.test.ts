/**
 * BF-347 black-box: ensureGraphDaemonForVault writes a cooldown breadcrumb
 * when a spawn fails, short-circuits subsequent ensure calls inside the
 * cooldown window with OwnerSpawnCooldownError, and lets a fresh spawn
 * happen once the window expires.
 *
 * No internal mocks — the failure is induced by pointing `bin` at a node
 * script that exits 1 without ever writing the owner record. We assert on
 * filesystem contents (cooldown breadcrumb), error types, and observed
 * spawn count.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { OwnerSpawnCooldownError } from '../errors.ts'
import {
  cooldownBreadcrumbPathFor,
  readCooldownBreadcrumb,
} from '../autoLaunch/ownership/cooldownBreadcrumb.ts'
import {
  ensureGraphDaemonForVault,
  subscribeOwnerDiagnostics,
  type OwnerDiagnosticListener,
} from '../index.ts'

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
)
const FAKE_BIN = join(FIXTURE_DIR, 'fake-vt-graphd.mjs')

// Inline failing-daemon script: exits non-zero before writing the owner
// record. The ensure path's waitForDaemonHealth will time out and raise
// DaemonLaunchTimeout — exactly the condition that should trip the
// cooldown breadcrumb.
const FAILING_DAEMON_SOURCE = `#!/usr/bin/env node
process.exit(1)
`

let vault: string
let failingBin: string
let spawnedPids: number[]

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'vt-graphd-bf347-ensure-cd-'))
  await mkdir(join(vault, '.voicetree'), { recursive: true })
  failingBin = join(vault, 'fail-vt-graphd.mjs')
  await writeFile(failingBin, FAILING_DAEMON_SOURCE, { encoding: 'utf8', mode: 0o755 })
  spawnedPids = []
})

afterEach(async () => {
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  await rm(vault, { recursive: true, force: true })
})

function failingBinCommand(): string {
  return `${process.execPath} ${failingBin}`
}

function workingBinCommand(): string {
  return `${process.execPath} ${FAKE_BIN}`
}

function makeSpawnObserver(): {
  unsubscribe: () => void
  spawnedCount: () => number
} {
  let count = 0
  const listener: OwnerDiagnosticListener = (event) => {
    if (event.kind === 'spawn-started') count += 1
  }
  const unsubscribe = subscribeOwnerDiagnostics(listener)
  return { unsubscribe, spawnedCount: () => count }
}

describe('ensureGraphDaemonForVault cooldown breadcrumb (BF-347)', () => {
  test('failed spawn writes cooldown; next call inside window throws OwnerSpawnCooldownError without re-spawning; call after expiry attempts spawn', async () => {
    const observer = makeSpawnObserver()

    try {
      // First call: launches the failing binary; ensure times out
      // because the child exits without binding an owner; cooldown
      // breadcrumb gets persisted.
      await expect(
        ensureGraphDaemonForVault(vault, 'test', {
          bin: failingBinCommand(),
          timeoutMs: 600,
          spawnCooldownMs: 1_500,
          initialBackoffMs: 25,
          maxBackoffMs: 50,
        }),
      ).rejects.toThrow()
      expect(observer.spawnedCount()).toBe(1)

      // Breadcrumb is on disk with the right shape.
      const breadcrumb = await readCooldownBreadcrumb(vault)
      expect(breadcrumb).not.toBeNull()
      expect(breadcrumb!.reason).toBe('spawn-failed')
      expect(breadcrumb!.canonicalProjectRoot).toBe(vault)
      expect(breadcrumb!.untilMs).toBeGreaterThan(Date.now())

      // Second call: still inside the cooldown window; throws
      // OwnerSpawnCooldownError without firing another spawn-started.
      await expect(
        ensureGraphDaemonForVault(vault, 'test', {
          bin: failingBinCommand(),
          timeoutMs: 600,
          spawnCooldownMs: 1_500,
          initialBackoffMs: 25,
          maxBackoffMs: 50,
        }),
      ).rejects.toBeInstanceOf(OwnerSpawnCooldownError)
      expect(observer.spawnedCount()).toBe(1)

      // Third call: wait past the cooldown deadline, then a real spawn
      // is attempted again. We point at the working fake daemon so the
      // ensure can succeed and prove the breadcrumb did not permanently
      // wedge the vault.
      await sleepUntilAfterCooldown(breadcrumb!.untilMs)

      const success = await ensureGraphDaemonForVault(vault, 'test', {
        bin: workingBinCommand(),
        timeoutMs: 5_000,
        spawnCooldownMs: 1_500,
      })
      expect(observer.spawnedCount()).toBe(2)
      expect(success.launched).toBe(true)
      spawnedPids.push(success.pid)

      // Successful spawn cleared the breadcrumb.
      const cleared = await readCooldownBreadcrumb(vault)
      expect(cleared).toBeNull()
    } finally {
      observer.unsubscribe()
    }
  }, 20_000)
})

function sleepUntilAfterCooldown(untilMs: number): Promise<void> {
  const remaining = untilMs - Date.now() + 100
  if (remaining <= 0) return Promise.resolve()
  return new Promise((res) => setTimeout(res, remaining))
}

// Quiet TS about unused export in some configs.
export { cooldownBreadcrumbPathFor }
