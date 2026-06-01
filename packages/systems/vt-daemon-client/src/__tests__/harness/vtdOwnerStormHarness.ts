/**
 * Shared black-box harness for BF-374 storm / stale / unsafe-owner /
 * cooldown / shutdown-isolation regression tests. Sibling of the graphd
 * harness at
 * `packages/systems/graph-db-client/src/__tests__/harness/ownerStormHarness.ts`.
 *
 * Built around three observable boundaries the protocol must respect:
 *
 *  - the on-disk owner record under `<project>/.voicetree/vtd.owner.json`,
 *  - the actual fake-vtd / vtd processes visible via `ps` matching
 *    `--project X`,
 *  - the recorded pid's liveness as seen by `kill(pid, 0)`.
 *
 * All helpers are POSIX (darwin/linux). No mocking of
 * `ensureVtDaemonForProject` internals — every assertion in callers must
 * resolve to one of the boundaries above (CLAUDE.md black-box rule).
 *
 * Differences from the graphd harness:
 *  - owner file is `vtd.owner.json`, not `graphd.owner.json`.
 *  - fake binary is `fake-vtd.mjs`, not `fake-vt-graphd.mjs`.
 *  - daemon-line regex matches `(vtd|fake-vtd)\.\w+\b.*--project\s+(\S+)` —
 *    NOT `--project-root`. vtd's argv shape is `--project` (BF-371). If the
 *    regex matched `--project-root` instead, every `ps` line would silently
 *    miss and the tests would pass on a broken protocol.
 *  - `readPersistedOwner` asserts `daemonKind === 'vtd'` after every
 *    decode (Gotcha 9): a stray graphd record at the sibling path could
 *    coincidentally decode as a vtd record if the schema discriminator
 *    is not checked.
 *  - `writeOwnerRecord` defaults `daemonKind: 'vtd'`.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ownerRecordFile,
  type CommandFingerprint,
  type OwnerRecord,
} from '@vt/daemon-lifecycle'

export const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
)

export const FAKE_BIN = join(FIXTURE_DIR, 'fake-vtd.mjs')
export const FAKE_BIN_COMMAND = `${process.execPath} ${FAKE_BIN}`
export const OWNER_FILE = 'vtd.owner.json'

/**
 * VTD's contract version. Lives in `@vt/vt-daemon/src/contract.ts` and is
 * mirrored here so the synthetic-record writer can default to the correct
 * value without taking a `@vt/vt-daemon` runtime dependency from the
 * client-only test harness.
 */
const VTD_CONTRACT_VERSION = '0.1.0'

export type Harness = {
  project: string
  /** Externally-spawned children we created (innocent victims, helpers). */
  spawned: ChildProcess[]
  /**
   * Daemon pids we did NOT spawn directly (e.g. produced by ensure() itself).
   * We track them so afterEach can SIGKILL leftovers if the test failed.
   */
  externalDaemonPids: number[]
}

export async function createHarness(
  prefix = 'vt-daemon-bf374-',
): Promise<Harness> {
  const project = await mkdtemp(join(tmpdir(), prefix))
  await mkdir(join(project, '.voicetree'), { recursive: true })
  return { project, spawned: [], externalDaemonPids: [] }
}

export async function destroyHarness(harness: Harness): Promise<void> {
  for (const child of harness.spawned) {
    if (child.pid) tryKill(child.pid, 'SIGKILL')
  }
  for (const pid of harness.externalDaemonPids) {
    tryKill(pid, 'SIGKILL')
  }
  await rm(harness.project, { recursive: true, force: true })
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

/**
 * Read `<project>/.voicetree/vtd.owner.json` and assert it decodes as a
 * vtd-tagged record. The `daemonKind === 'vtd'` check is load-bearing
 * (Gotcha 9): a sibling `graphd.owner.json` could in principle have a
 * shape that overlaps enough to satisfy the union schema; the assertion
 * is the guard.
 *
 * Under full-workspace concurrent test load the protocol's atomic-replace
 * writer can race a single `readFile` so the read lands on a partially-
 * truncated file — schema decode then returns null and the test sees a
 * spurious failure. The bounded retry-on-decode-failure window covers
 * that race without hiding genuine protocol bugs: a genuinely broken
 * record never resolves in 2 s.
 */
export async function readPersistedOwner(project: string): Promise<OwnerRecord> {
  const path = join(project, '.voicetree', OWNER_FILE)
  const deadline = Date.now() + 2000
  let lastError: Error | null = null
  while (Date.now() < deadline) {
    const raw = await readFile(path, 'utf8')
    const decoded = ownerRecordFile.decode(raw)
    if (decoded === null) {
      lastError = new Error('owner record on disk did not satisfy OwnerRecord schema')
    } else if (decoded.daemonKind !== 'vtd') {
      lastError = new Error(
        `owner record on disk has daemonKind=${decoded.daemonKind}, expected vtd`,
      )
    } else {
      return decoded
    }
    await new Promise((res) => setTimeout(res, 20))
  }
  throw lastError ?? new Error('owner record decode did not converge within retry window')
}

export async function readPersistedOwnerOrNull(
  project: string,
): Promise<OwnerRecord | null> {
  try {
    return await readPersistedOwner(project)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Atomically write a synthetic vtd owner record. Used by tests to set up
 * adversarial preconditions (stale dead pid, alive non-vtd pid, etc.) —
 * never to validate behavior. Validation happens by reading back through
 * {@link readPersistedOwner} after the protocol has run.
 */
export async function writeOwnerRecord(
  project: string,
  partial: Partial<OwnerRecord> & { pid: number; ownerNonce: string },
): Promise<OwnerRecord> {
  const canonicalProject = resolve(project)
  const now = Date.now()
  const record: OwnerRecord = {
    schemaVersion: 1,
    daemonKind: 'vtd',
    canonicalProject,
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
    join(project, '.voicetree', OWNER_FILE),
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
 * NOT match a vtd command fingerprint. That's the point — the unsafe
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
 * Count live vtd-shaped processes whose `--project` argument resolves to
 * `project`. Matches both the production `vtd.mjs` / `.ts` entries AND the
 * test fixture `fake-vtd.mjs` — the protocol invariant we're locking in
 * is "exactly one daemon child" regardless of which binary the harness
 * happens to be exercising.
 *
 * The match is intentionally fingerprint-shaped (executable + --project
 * path), not pid-set-based: callers can return their result pid 100 times
 * from a single-flight cache, but the kernel only knows the one real
 * process.
 */
export function countDaemonProcessesForProject(project: string): number {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new Error(
      `countDaemonProcessesForProject is POSIX-only, got ${process.platform}`,
    )
  }
  const canonical = resolve(project)
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
 * Same as {@link countDaemonProcessesForProject} but returns the matching
 * pids so callers can SIGKILL them if a test failed in the middle.
 */
export function listDaemonPidsForProject(project: string): number[] {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return []
  const canonical = resolve(project)
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

function matchesDaemonLine(line: string, canonicalProject: string): boolean {
  if (!line) return false
  // Match production vtd.<ext> and the test fake-vtd.<ext> entries; both
  // must point at our canonical project. vt-graphd uses `--project-root` —
  // VTD intentionally uses `--project` per BF-371. Mixing the two regexes
  // would silently match zero processes and the tests would pass on a
  // broken protocol.
  const re = /(vtd|fake-vtd)\.\w+\b.*--project\s+(\S+)/
  const match = re.exec(line)
  if (!match) return false
  return resolve(match[2]) === canonicalProject
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
 * Synthesize a command fingerprint that matches `node <FAKE_BIN> --project X`,
 * for tests that need the protocol to *successfully* identify a recorded
 * owner as vtd-shaped (e.g. stale-heartbeat-with-matching-fingerprint).
 */
export function fakeDaemonFingerprintFor(project: string): CommandFingerprint {
  return {
    executable: process.execPath,
    args: [FAKE_BIN, '--project', resolve(project)],
  }
}
