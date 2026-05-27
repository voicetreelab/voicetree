/**
 * Shared black-box harness for BF-348 storm / stale / unsafe-owner regression
 * tests. Built around three observable boundaries the protocol must respect:
 *
 *  - the on-disk owner record under `<vault>/.voicetree/graphd.owner.json`,
 *  - the actual vt-graphd processes visible via `ps` matching `--project-root X`,
 *  - the recorded pid's liveness as seen by `kill(pid, 0)`.
 *
 * All helpers are POSIX (darwin/linux). No mocking of `ensureGraphDaemonForVault`
 * internals — every assertion in callers must resolve to one of the boundaries
 * above (CLAUDE.md black-box rule).
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CONTRACT_VERSION,
  ownerRecordFile,
  type CommandFingerprint,
  type OwnerRecord,
} from '@vt/graph-db-protocol'

export const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
)

export const FAKE_BIN = join(FIXTURE_DIR, 'fake-vt-graphd.mjs')
export const FAKE_BIN_COMMAND = `${process.execPath} ${FAKE_BIN}`
export const OWNER_FILE = 'graphd.owner.json'

export type Harness = {
  vault: string
  /** Externally-spawned children we created (innocent victims, helpers). */
  spawned: ChildProcess[]
  /**
   * Daemon pids we did NOT spawn directly (e.g. produced by ensure() itself).
   * We track them so afterEach can SIGKILL leftovers if the test failed.
   */
  externalDaemonPids: number[]
}

export async function createHarness(prefix = 'vt-graphd-bf348-'): Promise<Harness> {
  const vault = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(vault, '.voicetree'), { recursive: true })
  return { vault, spawned: [], externalDaemonPids: [] }
}

export async function destroyHarness(harness: Harness): Promise<void> {
  for (const child of harness.spawned) {
    if (child.pid) tryKill(child.pid, 'SIGKILL')
  }
  for (const pid of harness.externalDaemonPids) {
    tryKill(pid, 'SIGKILL')
  }
  await rm(harness.vault, { recursive: true, force: true })
}

export function trackSpawn(harness: Harness, child: ChildProcess): ChildProcess {
  harness.spawned.push(child)
  return child
}

export function trackDaemonPid(harness: Harness, pid: number): void {
  harness.externalDaemonPids.push(pid)
}

function tryKill(pid: number, signal: NodeJS.Signals | 0 = 'SIGKILL'): void {
  try {
    process.kill(pid, signal)
  } catch {
    // already gone
  }
}

export async function readPersistedOwner(vault: string): Promise<OwnerRecord> {
  const raw = await readFile(join(vault, '.voicetree', OWNER_FILE), 'utf8')
  const decoded = ownerRecordFile.decode(raw)
  if (decoded === null) {
    throw new Error('owner record on disk did not satisfy OwnerRecord schema')
  }
  return decoded
}

/**
 * Atomically write a synthetic owner record. Used by tests to set up
 * adversarial preconditions (stale dead pid, alive non-vt-graphd pid, etc.)
 * — never to validate behavior. Validation happens by reading back through
 * {@link readPersistedOwner} after the protocol has run.
 */
export async function writeOwnerRecord(
  vault: string,
  partial: Partial<OwnerRecord> & { pid: number; ownerNonce: string },
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

/**
 * A long-running Node child that ignores SIGTERM the same way a hung
 * daemon would — used as the "innocent victim" pid in unsafe-owner tests.
 *
 * IMPORTANT: this child's command-line (`node -e 'setInterval(...)'`) does
 * NOT match a vt-graphd command fingerprint. That's the point — the unsafe
 * branch is supposed to refuse to kill it.
 */
export function spawnInnocentLongRunner(harness: Harness): ChildProcess {
  const child = spawn(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1e9)'],
    { detached: true, stdio: 'ignore' },
  )
  child.unref()
  return trackSpawn(harness, child)
}

export async function deadPid(): Promise<number> {
  // Spawn-and-exit yields a pid we know to be reaped.
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
  await new Promise<void>((res) => child.once('exit', () => res()))
  if (!child.pid) throw new Error('unable to obtain reaped pid')
  return child.pid
}

/**
 * Count live vt-graphd-shaped processes whose `--project-root` argument resolves
 * to `vault`. Matches both the production `vt-graphd.mjs` / `.ts` entries
 * AND the test fixture `fake-vt-graphd.mjs` — the protocol invariant we're
 * locking in is "exactly one daemon child" regardless of which binary the
 * harness happens to be exercising.
 *
 * The match is intentionally fingerprint-shaped (executable + --project-root path),
 * not pid-set-based: callers can return their result pid 100 times from a
 * single-flight cache, but the kernel only knows the one real process.
 */
export function countDaemonProcessesForVault(vault: string): number {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(
      `countDaemonProcessesForVault is POSIX-only, got ${process.platform}`,
    )
  }
  const canonical = resolve(vault)
  const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], {
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.status !== 0 || !result.stdout) {
    throw new Error(
      `ps failed: status=${result.status} stderr=${result.stderr ?? ''}`,
    )
  }
  let count = 0
  for (const line of result.stdout.split('\n')) {
    if (matchesDaemonLine(line, canonical)) count++
  }
  return count
}

/**
 * Same as {@link countDaemonProcessesForVault} but returns the matching
 * pids so callers can SIGKILL them if a test failed in the middle.
 */
export function listDaemonPidsForVault(vault: string): number[] {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return []
  const canonical = resolve(vault)
  const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], {
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.status !== 0 || !result.stdout) return []
  const pids: number[] = []
  for (const line of result.stdout.split('\n')) {
    if (!matchesDaemonLine(line, canonical)) continue
    const pidStr = line.trim().split(/\s+/, 1)[0]
    const pid = Number(pidStr)
    if (Number.isInteger(pid) && pid > 0) pids.push(pid)
  }
  return pids
}

function matchesDaemonLine(line: string, canonicalVault: string): boolean {
  if (!line) return false
  // Match production vt-graphd.<ext> and the test fake-vt-graphd.<ext>
  // entries; both must point at our canonical vault.
  const re = /(vt-graphd|fake-vt-graphd)\.\w+\b.*--project-root\s+(\S+)/
  const match = re.exec(line)
  if (!match) return false
  return resolve(match[2]) === canonicalVault
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    if (code === 'EPERM') return true
    return false
  }
}

/**
 * Synthesize a command fingerprint that matches `node <FAKE_BIN> --project-root X`,
 * for tests that need the protocol to *successfully* identify a recorded
 * owner as vt-graphd-shaped (e.g. stale-heartbeat-with-matching-fingerprint).
 */
export function fakeDaemonFingerprintFor(vault: string): CommandFingerprint {
  return {
    executable: process.execPath,
    args: [FAKE_BIN, '--project-root', resolve(vault)],
  }
}
