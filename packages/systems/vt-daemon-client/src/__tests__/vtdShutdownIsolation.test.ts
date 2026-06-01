/**
 * BF-374 lifecycle invariant: shutting down VTD does NOT kill vt-graphd.
 *
 * Symmetric counterpart to BF-346 (which asserts graphd survives every
 * caller exit). VTD is a NEW daemon kind that calls into the existing
 * graphd protocol — the gotcha BF-371 calls out is that a careless
 * SIGTERM-vtd handler could try to "tidy up" graphd at the same time
 * (because vtd ensures graphd at startup). It MUST NOT.
 *
 * The test guards the boundary:
 *
 *   GIVEN a project with a real fake-vt-graphd running (graphd.owner.json
 *         populated, a fake-vt-graphd process visible to ps).
 *   AND   a fake-vtd brought up via ensureVtDaemonForProject (vtd.owner.json
 *         populated, a fake-vtd process visible to ps).
 *   WHEN  we SIGTERM the vtd pid.
 *   THEN  within 2s:
 *           - vtd.owner.json is removed (vtd cleaned up after itself).
 *           - graphd.owner.json is STILL PRESENT.
 *           - countDaemonProcessesForProject(project) for fake-vtd is 0.
 *           - countDaemonProcessesForProject(project) for fake-vt-graphd is 1.
 *
 * Note: fake-vtd does not auto-ensure graphd (Leaf E's minimal fixture
 * deliberately omits that — real vtd does the graphd ensure inside its
 * own bin). So this test brings graphd up directly via its own fixture,
 * then exercises only the VTD lifecycle. The assertion shape would still
 * be valid for the real binary because the graphd ensure is a NO-OP when
 * graphd is already healthy.
 */

import { spawn, spawnSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  ownerRecordFile,
} from '@vt/daemon-lifecycle'
import { ensureVtDaemonForProject } from './harness/nodeEnsureVtDaemonForProject.ts'
import {
  FAKE_BIN_COMMAND,
  countDaemonProcessesForProject,
  createHarness,
  destroyHarness,
  isProcessAlive,
  listDaemonPidsForProject,
  trackDaemonPid,
  trackSpawn,
  type Harness,
} from './harness/vtdOwnerStormHarness.ts'

// Reach across to graphd's fake binary for the cross-daemon setup. The
// path is stable within the worktree; deliberately not imported from
// graph-db-client's harness to keep this test's dependency surface
// limited to public fixtures.
const GRAPHD_FAKE_BIN = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'graph-db-client',
  'src',
  '__tests__',
  'fixtures',
  'fake-vt-graphd.mjs',
)

const VTD_OWNER_FILE = 'vtd.owner.json'
const GRAPHD_OWNER_FILE = 'graphd.owner.json'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness('vt-daemon-bf374-shutdown-')
})

afterEach(async () => {
  for (const pid of listDaemonPidsForProject(harness.project)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  // Best-effort kill any leftover fake-vt-graphd visible to ps.
  for (const pid of listGraphdPidsForProject(harness.project)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  await destroyHarness(harness)
})

describe.runIf(process.platform !== 'win32')(
  'BF-374 lifecycle invariant: VTD shutdown does NOT kill vt-graphd',
  () => {
    test(
      'SIGTERM vtd → vtd.owner.json removed, graphd.owner.json + graphd process survive',
      async () => {
        // (1) Bring up a real fake-vt-graphd directly via its fixture.
        // Wait until graphd.owner.json carries a bound port.
        const graphdChild = spawn(
          process.execPath,
          [GRAPHD_FAKE_BIN, '--project-root', harness.project],
          { stdio: 'ignore', detached: false },
        )
        trackSpawn(harness, graphdChild)
        if (!graphdChild.pid) throw new Error('fake-vt-graphd failed to spawn')
        const graphdPid = graphdChild.pid

        await waitForBoundOwnerRecord(
          harness.project,
          GRAPHD_OWNER_FILE,
          5_000,
        )

        // (2) Bring up vtd via ensureVtDaemonForProject.
        const vtd = await ensureVtDaemonForProject(harness.project, 'electron', {
          bin: FAKE_BIN_COMMAND,
          timeoutMs: 10_000,
        })
        trackDaemonPid(harness, vtd.pid)

        // Snapshot pre-SIGTERM: both daemons up, both owner files present.
        expect(isProcessAlive(graphdPid)).toBe(true)
        expect(isProcessAlive(vtd.pid)).toBe(true)
        expect(countDaemonProcessesForProject(harness.project)).toBe(1)
        expect(countGraphdProcessesForProject(harness.project)).toBe(1)
        await expect(
          ownerFileExists(harness.project, VTD_OWNER_FILE),
        ).resolves.toBe(true)
        await expect(
          ownerFileExists(harness.project, GRAPHD_OWNER_FILE),
        ).resolves.toBe(true)

        // (3) SIGTERM the vtd. Allow up to 2s for the daemon's shutdown
        // handler to delete its owner record and exit. fake-vtd's
        // handler is deletePortFile → deleteOwner → server.close → exit.
        process.kill(vtd.pid, 'SIGTERM')
        await waitForPidGone(vtd.pid, 2_000)

        // (4) Invariant assertions.
        // 4a — vtd is gone.
        expect(isProcessAlive(vtd.pid)).toBe(false)
        expect(countDaemonProcessesForProject(harness.project)).toBe(0)

        // 4b — vtd.owner.json is removed (the daemon cleaned up).
        await expect(
          ownerFileExists(harness.project, VTD_OWNER_FILE),
        ).resolves.toBe(false)

        // 4c — graphd is UNTOUCHED.
        expect(isProcessAlive(graphdPid)).toBe(true)
        expect(countGraphdProcessesForProject(harness.project)).toBe(1)

        // 4d — graphd.owner.json is STILL PRESENT, and it really is a
        // graphd record (the `daemonKind === 'graphd'` assertion is the
        // discriminant guard from Gotcha 9, applied to the OTHER kind).
        await expect(
          ownerFileExists(harness.project, GRAPHD_OWNER_FILE),
        ).resolves.toBe(true)
        const graphdRecordRaw = await readFile(
          join(harness.project, '.voicetree', GRAPHD_OWNER_FILE),
          'utf8',
        )
        const graphdRecord = ownerRecordFile.decode(graphdRecordRaw)
        expect(graphdRecord).not.toBeNull()
        expect(graphdRecord?.daemonKind).toBe('graphd')
        expect(graphdRecord?.pid).toBe(graphdPid)
      },
      30_000,
    )
  },
)

async function ownerFileExists(
  project: string,
  ownerFile: string,
): Promise<boolean> {
  try {
    await access(join(project, '.voicetree', ownerFile))
    return true
  } catch {
    return false
  }
}

async function waitForBoundOwnerRecord(
  project: string,
  ownerFile: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(
        join(project, '.voicetree', ownerFile),
        'utf8',
      )
      const parsed: unknown = JSON.parse(raw)
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        'port' in parsed &&
        typeof (parsed as { port: unknown }).port === 'number'
      ) {
        return
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    await new Promise((res) => setTimeout(res, 25))
  }
  throw new Error(
    `${ownerFile} did not get a bound port within ${timeoutMs}ms`,
  )
}

async function waitForPidGone(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return
    await new Promise((res) => setTimeout(res, 25))
  }
}

// --- graphd-specific ps helpers ---------------------------------------
// We can't reuse the vtd harness's `countDaemonProcessesForProject` for
// graphd — its regex matches `--project`, graphd uses `--project-root`.
// These two helpers are the graphd analogue.

function countGraphdProcessesForProject(project: string): number {
  return listGraphdPidsForProject(project).length
}

function listGraphdPidsForProject(project: string): number[] {
  if (process.platform !== 'darwin' && process.platform !== 'linux') return []
  const canonical = resolve(project)
  const result = spawnSync('ps', ['-A', '-o', 'pid=,command='], {
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.status !== 0 || !result.stdout) return []
  const re = /(vt-graphd|fake-vt-graphd)\.\w+\b.*--project-root\s+(\S+)/
  const pids: number[] = []
  for (const line of result.stdout.split('\n')) {
    const match = re.exec(line)
    if (!match) continue
    if (resolve(match[2]) !== canonical) continue
    const pidStr = line.trim().split(/\s+/, 1)[0]
    const pid = Number(pidStr)
    if (Number.isInteger(pid) && pid > 0) pids.push(pid)
  }
  return pids
}
