/**
 * BF-348 regression: stale dead-owner reclaim + multi-caller convergence.
 *
 * Scenario from the design (D4 stale reclaim + Migration step 7):
 *
 *   <project>/.voicetree/graphd.owner.json points at a pid that is verifiably
 *   dead (process previously exited, kill(pid, 0) → ESRCH). Many callers
 *   race in. The protocol MUST:
 *
 *     1. Detect the staleness (dead pid) and remove the stale record.
 *     2. Spawn at most ONE replacement vt-graphd child.
 *     3. Converge ALL callers (the reclaimer plus 99 latecomers) onto that
 *        one new healthy owner.
 *
 * This is the regression test for the "stale port, project_not_open cascade"
 * mode of the May 22 incident: many callers each thought they were the
 * first to notice a dead daemon and would otherwise stampede the spawn
 * path. Observability is via the actual `ps` process count and the on-disk
 * owner record — never by inspecting protocol internals.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ensureGraphDaemonForProject } from '../index.ts'
import {
  FAKE_BIN_COMMAND,
  countDaemonProcessesForProject,
  createHarness,
  deadPid,
  destroyHarness,
  fakeDaemonFingerprintFor,
  listDaemonPidsForProject,
  readPersistedOwner,
  trackDaemonPid,
  writeOwnerRecord,
  type Harness,
} from './harness/ownerStormHarness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness('vt-graphd-bf348-stale-')
})

afterEach(async () => {
  for (const pid of listDaemonPidsForProject(harness.project)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  await destroyHarness(harness)
})

describe('BF-348 regression: stale dead-owner reclaim under storm', () => {
  test(
    'stale dead-pid owner + 100 concurrent callers → exactly one new daemon, all callers converge',
    async () => {
      const stalePid = await deadPid()
      const staleNonce = 'stale-dead-pid-nonce-bf348'

      await writeOwnerRecord(harness.project, {
        pid: stalePid,
        port: null,
        ownerNonce: staleNonce,
        heartbeatAtMs: Date.now(),
        // Matching fingerprint isn't required when pid is dead: the
        // decision is 'stale-reclaim' on the dead-pid branch regardless,
        // and we want the test to mirror what a real crashed daemon would
        // leave behind — a record whose recorded fingerprint matches what
        // vt-graphd would have written for itself.
        commandFingerprint: fakeDaemonFingerprintFor(harness.project),
      })

      const callCount = 100
      const results = await Promise.all(
        Array.from({ length: callCount }, () =>
          ensureGraphDaemonForProject(harness.project, 'electron', {
            bin: FAKE_BIN_COMMAND,
            timeoutMs: 10_000,
          }),
        ),
      )

      // (1) The stale nonce is gone — the on-disk record now reflects the
      // freshly reclaimed owner.
      const owner = await readPersistedOwner(harness.project)
      trackDaemonPid(harness, owner.pid)
      expect(owner.ownerNonce).not.toBe(staleNonce)
      expect(owner.pid).not.toBe(stalePid)
      expect(owner.port).not.toBeNull()

      // (2) Exactly ONE vt-graphd child visible to ps. The dead pid was
      // never alive, so the count is the new daemon and nothing else.
      const liveDaemonCount = countDaemonProcessesForProject(harness.project)
      expect(liveDaemonCount).toBe(1)

      // (3) All 100 callers converge on the same new owner. The
      // reclaimer's launched=true; all others either reused or finalised
      // the in-flight spawn (launched=false). The CRITICAL invariant: every
      // caller agrees on port/pid/nonce.
      const ports = new Set(results.map((r) => r.port))
      const pids = new Set(results.map((r) => r.pid))
      const nonces = new Set(results.map((r) => r.ownerNonce))
      expect(ports.size).toBe(1)
      expect(pids.size).toBe(1)
      expect(nonces.size).toBe(1)
      expect([...pids][0]).toBe(owner.pid)
      expect([...ports][0]).toBe(owner.port)
      expect([...nonces][0]).toBe(owner.ownerNonce)

      // (4) Sample-probe /health: the daemon reports the matching
      // identity. (Health verification gates the protocol-side reuse
      // decision, so this is what every caller is implicitly trusting.)
      const sampleHealth = await Promise.all(
        results.slice(0, 5).map((r) => r.client.health()),
      )
      for (const body of sampleHealth) {
        expect(body.owner?.ownerNonce).toBe(owner.ownerNonce)
        expect(body.owner?.port).toBe(owner.port)
      }
    },
    30_000,
  )
})
