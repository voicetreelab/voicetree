import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  CONTRACT_VERSION,
  ownerRecordFile,
  type OwnerRecord,
} from '@vt/graph-db-protocol'
import {
  DaemonLaunchTimeout,
  OwnerWaitTimeoutError,
  UnsafeOwnerError,
  ensureGraphDaemonForVault,
  type EnsureGraphDaemonResult,
} from '../index.ts'

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
)
const FAKE_BIN = join(FIXTURE_DIR, 'fake-vt-graphd.mjs')
const FAKE_BIN_COMMAND = `${process.execPath} ${FAKE_BIN}`

const OWNER_FILE = 'graphd.owner.json'

type Harness = {
  vault: string
  spawned: ChildProcess[]
  servers: Server[]
}

let harness: Harness

beforeEach(async () => {
  const vault = await mkdtemp(join(tmpdir(), 'vt-graphd-bf344-'))
  await mkdir(join(vault, '.voicetree'), { recursive: true })
  harness = { vault, spawned: [], servers: [] }
})

afterEach(async () => {
  for (const child of harness.spawned) {
    if (child.pid) {
      try {
        process.kill(child.pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
  }
  await Promise.all(
    harness.servers.map(
      (server) =>
        new Promise<void>((res) => {
          server.close(() => res())
        }),
    ),
  )
  await rm(harness.vault, { recursive: true, force: true })
})

function trackSpawn(child: ChildProcess): ChildProcess {
  harness.spawned.push(child)
  return child
}

function trackServer(server: Server): Server {
  harness.servers.push(server)
  return server
}

async function readPersistedOwner(vault: string): Promise<OwnerRecord> {
  const raw = await readFile(join(vault, '.voicetree', OWNER_FILE), 'utf8')
  const decoded = ownerRecordFile.decode(raw)
  if (decoded === null) {
    throw new Error('owner record on disk did not satisfy OwnerRecord schema')
  }
  return decoded
}

function spawnLongRunningChild(): ChildProcess {
  // A pid that stays alive without binding any port — used as the "in-flight
  // owner" or "unrelated alive owner" in tests that should never spawn or
  // kill it.
  const child = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1e9)'],
    { detached: true, stdio: 'ignore' },
  )
  child.unref()
  return trackSpawn(child)
}

async function startHealthServer(
  serveBody: (port: number) => unknown,
): Promise<number> {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const port = (server.address() as { port: number }).port
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(serveBody(port)))
      return
    }
    res.writeHead(404)
    res.end()
  })
  trackServer(server)
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()))
  return (server.address() as { port: number }).port
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
    daemonKind: 'graphd',
    canonicalVault,
    pid: partial.pid,
    ppid: partial.ppid ?? 0,
    port: partial.port ?? null,
    ownerNonce: partial.ownerNonce,
    startedAtMs: partial.startedAtMs ?? now,
    heartbeatAtMs: partial.heartbeatAtMs ?? now,
    callerKind: partial.callerKind ?? 'test',
    contractVersion: partial.contractVersion ?? CONTRACT_VERSION,
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
  return child.pid!
}

describe('ensureGraphDaemonForVault — black-box', () => {
  test('100 concurrent callers cold-start exactly one daemon, one owner record, one port', async () => {
    const callCount = 100
    const calls = Array.from({ length: callCount }, () =>
      ensureGraphDaemonForVault(harness.vault, 'test', {
        bin: FAKE_BIN_COMMAND,
        timeoutMs: 10_000,
      }),
    )

    const results = await Promise.all(calls)

    // Every caller shares the same in-process single-flight, so they all
    // see launched=true for the one underlying spawn. The cross-caller
    // single-spawn invariant lives in the convergence of pid/port/nonce
    // below — exactly one daemon, one record.
    expect(results.every((r) => r.launched)).toBe(true)

    const ports = new Set(results.map((r) => r.port))
    expect(ports.size).toBe(1)

    const pids = new Set(results.map((r) => r.pid))
    expect(pids.size).toBe(1)

    const owner = await readPersistedOwner(harness.vault)
    expect(owner.port).toBe([...ports][0])
    expect(owner.pid).toBe([...pids][0])
    expect(owner.ownerNonce).toBe(results[0].ownerNonce)

    // The daemon process is the one we spawned — track it for cleanup.
    harness.spawned.push({ pid: owner.pid } as ChildProcess)

    // Every returned client points at the same daemon.
    const healthResponses = await Promise.all(
      results.slice(0, 5).map((r) => r.client.health()),
    )
    for (const body of healthResponses) {
      expect(body.vault).toBe(resolve(harness.vault))
    }
  }, 30_000)

  test('existing healthy owner is reused — no new child is spawned', async () => {
    const ownerNonce = 'static-nonce-for-reuse-test'
    const canonicalVault = resolve(harness.vault)
    const port = await startHealthServer((boundPort) => ({
      version: '0.2.0',
      vault: canonicalVault,
      uptimeSeconds: 1,
      sessionCount: 0,
      owner: {
        schemaVersion: 1,
        canonicalVault,
        pid: process.pid,
        ppid: 0,
        port: boundPort,
        ownerNonce,
        contractVersion: CONTRACT_VERSION,
      },
    }))
    await writeOwnerRecord(harness.vault, {
      pid: process.pid,
      port,
      ownerNonce,
    })

    const result = await ensureGraphDaemonForVault(harness.vault, 'test', {
      bin: FAKE_BIN_COMMAND,
      timeoutMs: 2_000,
    })

    expect(result.launched).toBe(false)
    expect(result.port).toBe(port)
    expect(result.pid).toBe(process.pid)
    expect(result.ownerNonce).toBe(ownerNonce)

    // The on-disk record is untouched.
    const owner = await readPersistedOwner(harness.vault)
    expect(owner.pid).toBe(process.pid)
    expect(owner.port).toBe(port)
  }, 10_000)

  test('stale owner record with dead pid → reclaimed and respawned, single port', async () => {
    const stalePid = await deadPid()
    await writeOwnerRecord(harness.vault, {
      pid: stalePid,
      port: null,
      ownerNonce: 'stale-dead-pid-nonce',
      heartbeatAtMs: Date.now(),
      commandFingerprint: {
        executable: process.execPath,
        args: [FAKE_BIN, '--project-root', resolve(harness.vault)],
      },
    })

    const result = await ensureGraphDaemonForVault(harness.vault, 'test', {
      bin: FAKE_BIN_COMMAND,
      timeoutMs: 10_000,
    })

    expect(result.launched).toBe(true)
    expect(result.port).toBeGreaterThan(0)
    expect(result.pid).not.toBe(stalePid)
    expect(result.ownerNonce).not.toBe('stale-dead-pid-nonce')

    const owner = await readPersistedOwner(harness.vault)
    expect(owner.pid).toBe(result.pid)
    expect(owner.port).toBe(result.port)
    harness.spawned.push({ pid: owner.pid } as ChildProcess)
  }, 15_000)

  test('mismatching health nonce → UnsafeOwnerError, no kill, owner record intact', async () => {
    const recordedNonce = 'expected-nonce'
    const observedNonce = 'totally-different-nonce'
    const canonicalVault = resolve(harness.vault)
    const port = await startHealthServer((boundPort) => ({
      version: '0.2.0',
      vault: canonicalVault,
      uptimeSeconds: 1,
      sessionCount: 0,
      owner: {
        schemaVersion: 1,
        canonicalVault,
        pid: process.pid,
        ppid: 0,
        port: boundPort,
        ownerNonce: observedNonce,
        contractVersion: CONTRACT_VERSION,
      },
    }))
    const recordedPid = spawnLongRunningChild().pid!
    await writeOwnerRecord(harness.vault, {
      pid: recordedPid,
      port,
      ownerNonce: recordedNonce,
    })

    await expect(
      ensureGraphDaemonForVault(harness.vault, 'test', {
        bin: FAKE_BIN_COMMAND,
        timeoutMs: 2_000,
      }),
    ).rejects.toBeInstanceOf(UnsafeOwnerError)

    // The recorded pid is still alive — we must not have killed it.
    expect(() => process.kill(recordedPid, 0)).not.toThrow()

    // Owner record on disk is unchanged.
    const owner = await readPersistedOwner(harness.vault)
    expect(owner.pid).toBe(recordedPid)
    expect(owner.ownerNonce).toBe(recordedNonce)
  }, 10_000)

  test('lock-without-port (alive in-flight owner) → waits, then OwnerWaitTimeoutError', async () => {
    const inflightChild = spawnLongRunningChild()
    const recordedPid = inflightChild.pid!
    await writeOwnerRecord(harness.vault, {
      pid: recordedPid,
      port: null,
      ownerNonce: 'inflight-nonce',
      heartbeatAtMs: Date.now(),
      // Fingerprint deliberately not vt-graphd-shaped; with port=null and
      // a fresh heartbeat the decision must still be `wait`, not unsafe.
      commandFingerprint: {
        executable: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1e9)'],
      },
    })

    const start = Date.now()
    await expect(
      ensureGraphDaemonForVault(harness.vault, 'test', {
        bin: FAKE_BIN_COMMAND,
        timeoutMs: 800,
      }),
    ).rejects.toBeInstanceOf(OwnerWaitTimeoutError)
    const elapsed = Date.now() - start
    expect(elapsed).toBeGreaterThanOrEqual(700)
    expect(elapsed).toBeLessThan(3_000)

    // The in-flight owner pid was never killed — it's still alive.
    expect(() => process.kill(recordedPid, 0)).not.toThrow()

    // The owner record is still on disk untouched.
    const owner = await readPersistedOwner(harness.vault)
    expect(owner.pid).toBe(recordedPid)
    expect(owner.port).toBeNull()
  }, 10_000)
})

// Quiet TS about unused imports in some configs.
export type { EnsureGraphDaemonResult }
export { DaemonLaunchTimeout }
