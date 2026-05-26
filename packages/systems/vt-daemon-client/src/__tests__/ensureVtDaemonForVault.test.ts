/**
 * Black-box tests for `ensureVtDaemonForVault` (BF-373).
 *
 * Per CLAUDE.md: no internal mocks. Every assertion resolves to an
 * observable boundary —
 *   - on-disk owner record (`<vault>/.voicetree/vtd.owner.json`),
 *   - on-disk port file (`<vault>/.voicetree/rpc.port`),
 *   - on-disk auth token (`<vault>/.voicetree/auth-token`),
 *   - the daemon's `/health` response,
 *   - the daemon process's liveness (via `kill(pid, 0)`).
 *
 * The fake VTD (`fixtures/fake-vtd.mjs`) implements the BF-371 binary
 * contract narrowly enough to drive every branch of the ensure loop
 * without booting the real daemon's tmux + agent runtime + graphd
 * subprocess. BF-374 will extend the fixture with adversarial env vars.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  cooldownBreadcrumbPathFor,
  ownerRecordFile,
  OwnerSpawnCooldownError,
  UnsafeOwnerError,
  type OwnerRecord,
} from '@vt/daemon-lifecycle'
import { ensureVtDaemonForVault } from '../index.ts'

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
)
const FAKE_BIN = join(FIXTURE_DIR, 'fake-vtd.mjs')
const FAKE_BIN_COMMAND = `${process.execPath} ${FAKE_BIN}`
const OWNER_FILE = 'vtd.owner.json'
const AUTH_TOKEN_FILE = 'auth-token'

const VTD_CONTRACT_VERSION = '0.1.0'

type Harness = {
  vault: string
  spawned: ChildProcess[]
  externalDaemonPids: number[]
}

let harness: Harness

beforeEach(async () => {
  const vault = await mkdtemp(join(tmpdir(), 'vt-daemon-client-bf373-'))
  await mkdir(join(vault, '.voicetree'), { recursive: true })
  harness = { vault, spawned: [], externalDaemonPids: [] }
})

afterEach(async () => {
  for (const child of harness.spawned) {
    if (child.pid) tryKill(child.pid, 'SIGKILL')
  }
  for (const pid of harness.externalDaemonPids) {
    tryKill(pid, 'SIGKILL')
  }
  await rm(harness.vault, { recursive: true, force: true })
})

function trackSpawn(child: ChildProcess): ChildProcess {
  harness.spawned.push(child)
  return child
}

function trackDaemonPid(pid: number): void {
  harness.externalDaemonPids.push(pid)
}

function tryKill(pid: number, signal: NodeJS.Signals | 0 = 'SIGKILL'): void {
  try {
    process.kill(pid, signal)
  } catch {
    // already gone
  }
}

async function readPersistedOwner(vault: string): Promise<OwnerRecord> {
  const raw = await readFile(join(vault, '.voicetree', OWNER_FILE), 'utf8')
  const decoded = ownerRecordFile.decode(raw)
  if (decoded === null) {
    throw new Error('owner record on disk did not satisfy OwnerRecord schema')
  }
  if (decoded.daemonKind !== 'vtd') {
    throw new Error(
      `owner record on disk has daemonKind=${decoded.daemonKind}, expected vtd`,
    )
  }
  return decoded
}

async function readAuthTokenOnDisk(vault: string): Promise<string> {
  return (
    await readFile(join(vault, '.voicetree', AUTH_TOKEN_FILE), 'utf8')
  ).trim()
}

function spawnLongRunningChild(): ChildProcess {
  // A pid that stays alive without binding any port — used as the "in-flight
  // owner" or "unrelated alive owner" in tests that should never spawn
  // or kill it. Its command-line is deliberately NOT vtd-shaped.
  const child = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1e9)'],
    { detached: true, stdio: 'ignore' },
  )
  child.unref()
  return trackSpawn(child)
}

async function writeOwnerRecord(
  vault: string,
  partial: Partial<OwnerRecord> & {
    pid: number
    ownerNonce: string
  },
): Promise<OwnerRecord> {
  const canonicalVault = resolve(vault)
  const now = Date.now()
  const record: OwnerRecord = {
    schemaVersion: 1,
    daemonKind: 'vtd',
    canonicalVault,
    pid: partial.pid,
    ppid: partial.ppid ?? 0,
    port: partial.port ?? null,
    ownerNonce: partial.ownerNonce,
    startedAtMs: partial.startedAtMs ?? now,
    heartbeatAtMs: partial.heartbeatAtMs ?? now,
    callerKind: partial.callerKind ?? 'test',
    contractVersion: partial.contractVersion ?? VTD_CONTRACT_VERSION,
    commandFingerprint: partial.commandFingerprint ?? {
      executable: '/usr/bin/some-other-thing',
      args: ['--unrelated'],
    },
  }
  await writeFile(
    join(vault, '.voicetree', OWNER_FILE),
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8',
  )
  return record
}

async function deadPid(): Promise<number> {
  // Spawn-and-exit yields a pid we know to be reaped.
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
  await new Promise<void>((res) => child.once('exit', () => res()))
  if (!child.pid) throw new Error('unable to obtain reaped pid')
  return child.pid
}

describe('ensureVtDaemonForVault — black-box', () => {
  test('cold-start: spawns one VTD, owner record bound to port, auth-token published', async () => {
    const result = await ensureVtDaemonForVault(harness.vault, 'electron', {
      bin: FAKE_BIN_COMMAND,
      timeoutMs: 10_000,
    })

    expect(result.launched).toBe(true)
    expect(result.port).toBeGreaterThan(0)
    expect(result.pid).toBeGreaterThan(0)
    expect(result.ownerNonce).toMatch(/.+/)
    expect(result.authToken).toMatch(/.+/)

    // Track for cleanup.
    trackDaemonPid(result.pid)

    // Owner record on disk matches the result.
    const owner = await readPersistedOwner(harness.vault)
    expect(owner.pid).toBe(result.pid)
    expect(owner.port).toBe(result.port)
    expect(owner.ownerNonce).toBe(result.ownerNonce)
    expect(owner.canonicalVault).toBe(resolve(harness.vault))

    // Auth token on disk matches the result's token.
    const onDiskToken = await readAuthTokenOnDisk(harness.vault)
    expect(onDiskToken).toBe(result.authToken)

    // /health round-trips against the same VTD identity.
    const health = await result.client.health()
    expect(health.daemonKind).toBe('vtd')
    expect(health.owner?.ownerNonce).toBe(result.ownerNonce)
    expect(health.owner?.port).toBe(result.port)
  }, 15_000)

  test('reuse: a second ensure call returns the same pid/port without spawning', async () => {
    const first = await ensureVtDaemonForVault(harness.vault, 'electron', {
      bin: FAKE_BIN_COMMAND,
      timeoutMs: 10_000,
    })
    trackDaemonPid(first.pid)

    const second = await ensureVtDaemonForVault(harness.vault, 'electron', {
      bin: FAKE_BIN_COMMAND,
      timeoutMs: 5_000,
    })

    expect(second.launched).toBe(false)
    expect(second.pid).toBe(first.pid)
    expect(second.port).toBe(first.port)
    expect(second.ownerNonce).toBe(first.ownerNonce)
    expect(second.authToken).toBe(first.authToken)

    // The on-disk record is the same — no second daemon was spawned.
    const owner = await readPersistedOwner(harness.vault)
    expect(owner.pid).toBe(first.pid)
    expect(owner.port).toBe(first.port)
  }, 20_000)

  test('per-process single-flight: 50 concurrent ensure calls produce exactly one owner record', async () => {
    const callCount = 50
    const calls = Array.from({ length: callCount }, () =>
      ensureVtDaemonForVault(harness.vault, 'electron', {
        bin: FAKE_BIN_COMMAND,
        timeoutMs: 10_000,
      }),
    )
    const results = await Promise.all(calls)

    // All 50 callers converge on one pid, one port, one ownerNonce, one
    // authToken — observable proof exactly one VTD was launched.
    const pids = new Set(results.map((r) => r.pid))
    const ports = new Set(results.map((r) => r.port))
    const nonces = new Set(results.map((r) => r.ownerNonce))
    const tokens = new Set(results.map((r) => r.authToken))
    expect(pids.size).toBe(1)
    expect(ports.size).toBe(1)
    expect(nonces.size).toBe(1)
    expect(tokens.size).toBe(1)

    // Owner record on disk matches.
    const owner = await readPersistedOwner(harness.vault)
    expect(owner.pid).toBe([...pids][0])
    expect(owner.port).toBe([...ports][0])
    expect(owner.ownerNonce).toBe([...nonces][0])
    trackDaemonPid(owner.pid)

    // Sample-probe the daemon directly — every probed client must reach
    // the same VTD identity.
    const sampleHealth = await Promise.all(
      results.slice(0, 5).map((r) => r.client.health()),
    )
    for (const body of sampleHealth) {
      expect(body.owner?.ownerNonce).toBe(owner.ownerNonce)
      expect(body.owner?.port).toBe(owner.port)
    }
  }, 30_000)

  test('stale reclaim (dead pid): record is replaced, new ownerNonce differs', async () => {
    const stalePid = await deadPid()
    await writeOwnerRecord(harness.vault, {
      pid: stalePid,
      port: null,
      ownerNonce: 'stale-dead-pid-nonce',
      heartbeatAtMs: Date.now(),
      // Fingerprint deliberately vtd-shaped so safe-kill predicates
      // would authorise reclamation even if the pid were alive.
      commandFingerprint: {
        executable: process.execPath,
        args: [FAKE_BIN, '--vault', resolve(harness.vault)],
      },
    })

    const result = await ensureVtDaemonForVault(harness.vault, 'electron', {
      bin: FAKE_BIN_COMMAND,
      timeoutMs: 10_000,
    })
    trackDaemonPid(result.pid)

    expect(result.launched).toBe(true)
    expect(result.pid).not.toBe(stalePid)
    expect(result.ownerNonce).not.toBe('stale-dead-pid-nonce')
    expect(result.port).toBeGreaterThan(0)

    const owner = await readPersistedOwner(harness.vault)
    expect(owner.pid).toBe(result.pid)
    expect(owner.port).toBe(result.port)
    expect(owner.ownerNonce).toBe(result.ownerNonce)
  }, 15_000)

  test('unsafe owner (live unrelated pid + mismatching health nonce): throws UnsafeOwnerError, owner left intact', async () => {
    // A live pid whose command fingerprint clearly is NOT vtd-shaped, and
    // a /health response whose ownerNonce does not match the recorded one.
    // The decision must be unsafe — the protocol refuses to kill an
    // unrelated process or reuse a daemon it cannot identify.
    const recordedNonce = 'expected-nonce'
    const observedNonce = 'totally-different-nonce'
    const canonicalVault = resolve(harness.vault)
    const port = await startHealthServerWithNonce(
      canonicalVault,
      observedNonce,
    )
    const recordedPid = spawnLongRunningChild().pid!

    await writeOwnerRecord(harness.vault, {
      pid: recordedPid,
      port,
      ownerNonce: recordedNonce,
    })

    await expect(
      ensureVtDaemonForVault(harness.vault, 'electron', {
        bin: FAKE_BIN_COMMAND,
        timeoutMs: 2_000,
      }),
    ).rejects.toBeInstanceOf(UnsafeOwnerError)

    // The recorded pid is still alive — we did not kill it.
    expect(() => process.kill(recordedPid, 0)).not.toThrow()

    // Owner record on disk is unchanged.
    const owner = await readPersistedOwner(harness.vault)
    expect(owner.pid).toBe(recordedPid)
    expect(owner.ownerNonce).toBe(recordedNonce)
  }, 10_000)

  test('cooldown suppression: a fresh cooldown breadcrumb makes ensure throw without spawning', async () => {
    const now = Date.now()
    const breadcrumb = {
      schemaVersion: 1 as const,
      canonicalVault: resolve(harness.vault),
      writtenAtMs: now,
      untilMs: now + 60_000,
      reason: 'test-injected',
      writerCallerKind: 'test' as const,
      writerPid: process.pid,
      lastErrorName: 'DaemonLaunchTimeout',
      lastErrorMessage: 'synthetic — never spawned',
    }
    await writeFile(
      cooldownBreadcrumbPathFor(harness.vault, 'vtd'),
      `${JSON.stringify(breadcrumb, null, 2)}\n`,
      'utf8',
    )

    await expect(
      ensureVtDaemonForVault(harness.vault, 'electron', {
        bin: FAKE_BIN_COMMAND,
        timeoutMs: 2_000,
      }),
    ).rejects.toBeInstanceOf(OwnerSpawnCooldownError)

    // No owner record was written — ensure short-circuited before any
    // spawn attempt could touch the on-disk record.
    await expect(
      readFile(join(harness.vault, '.voicetree', OWNER_FILE), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  }, 10_000)
})

// Minimal HTTP health server used by the unsafe-owner test. Speaks the
// VtDaemonHealthResponse wire shape; the caller-controlled `ownerNonce`
// is what makes the health mismatch the recorded one.
async function startHealthServerWithNonce(
  canonicalVault: string,
  observedNonce: string,
): Promise<number> {
  const { createServer } = await import('node:http')
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const addr = server.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      const body = {
        version: VTD_CONTRACT_VERSION,
        vault: canonicalVault,
        uptimeSeconds: 1,
        daemonKind: 'vtd',
        owner: {
          schemaVersion: 1,
          canonicalVault,
          pid: process.pid,
          ppid: 0,
          port,
          ownerNonce: observedNonce,
          contractVersion: VTD_CONTRACT_VERSION,
        },
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()))
  // Close on test exit by hooking into the harness via a finalizer side-channel:
  // we register the server's underlying socket pid? Actually we just register a
  // process-exit listener — for the duration of the test the server is needed.
  // The test runner's `afterEach` already wipes the vault dir; close the
  // server when the process exits (sufficient for vitest test isolation).
  process.once('beforeExit', () => server.close())
  return (server.address() as { port: number }).port
}
