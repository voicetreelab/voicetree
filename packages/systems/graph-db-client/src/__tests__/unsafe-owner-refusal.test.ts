/**
 * BF-348 regression: unsafe-owner refusal and lock-without-port no-fanout.
 *
 * Two adversarial preconditions, both about a recorded owner that ISN'T
 * the healthy vt-graphd it claims to be:
 *
 *   (A) An alive pid whose command-line is NOT a vt-graphd invocation
 *       (an "innocent victim" pid — could be any unrelated long-running
 *       Node process). Heartbeat is stale.
 *
 *       The protocol MUST refuse to reclaim (UnsafeOwnerError /
 *       fingerprint-mismatch) and MUST NOT SIGTERM/SIGKILL that pid.
 *
 *   (B) An alive pid AND port=null AND heartbeat fresh.
 *
 *       The protocol MUST wait with bounded backoff and surface
 *       OwnerWaitTimeoutError. Many concurrent callers MUST NOT each
 *       spawn a vt-graphd child — `ps` must see zero new daemons for the
 *       project while every caller is waiting.
 *
 * Both scenarios were latent risks behind the May 22 incident's "many
 * vt-graphd children, project_not_open cascade" failure mode.
 */

import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ensureGraphDaemonForProject, OwnerWaitTimeoutError, UnsafeOwnerError } from '../index.ts'
import {
  FAKE_BIN_COMMAND,
  countDaemonProcessesForProject,
  createHarness,
  destroyHarness,
  isProcessAlive,
  listDaemonPidsForProject,
  readPersistedOwner,
  spawnInnocentLongRunner,
  type Harness,
  writeOwnerRecord,
} from './harness/ownerStormHarness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness('vt-graphd-bf348-unsafe-')
})

afterEach(async () => {
  // Belt-and-braces cleanup: any vt-graphd we somehow spawned for this
  // project gets SIGKILLed before the temp directory is removed. (These
  // tests are precisely about NOT spawning, so this should be a no-op
  // when tests pass.)
  for (const pid of listDaemonPidsForProject(harness.project)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  await destroyHarness(harness)
})

describe('BF-348 regression: unsafe-owner pid refusal', () => {
  test(
    'alive innocent pid + non-matching command fingerprint + stale heartbeat → UnsafeOwnerError, pid NOT killed, NO daemon spawned',
    async () => {
      const innocent = spawnInnocentLongRunner(harness)
      const innocentPid = innocent.pid
      expect(innocentPid).toBeDefined()
      if (!innocentPid) throw new Error('innocent child failed to spawn')

      // A pid that's alive but whose command-line is `node -e setInterval(...)` —
      // does NOT match the vt-graphd command fingerprint we record below.
      // Combined with a stale heartbeat that's far older than the default
      // 15s staleHeartbeatMs, the protocol routes to unsafe-owner with
      // reason 'fingerprint-mismatch'.
      const staleHeartbeat = Date.now() - 60_000
      const recordedNonce = 'unsafe-fingerprint-nonce'
      await writeOwnerRecord(harness.project, {
        pid: innocentPid,
        port: null,
        ownerNonce: recordedNonce,
        heartbeatAtMs: staleHeartbeat,
        startedAtMs: staleHeartbeat,
        // Recorded fingerprint that simulates what a real vt-graphd would
        // have written for itself — the LIVE command-line is `node -e ...`
        // and won't match, which is precisely what triggers fingerprint-
        // mismatch.
        commandFingerprint: {
          executable: process.execPath,
          args: ['/opt/voicetree/vt-graphd.mjs', '--project-root', resolve(harness.project)],
        },
      })

      // Snapshot: zero vt-graphd processes for this project before the call.
      expect(countDaemonProcessesForProject(harness.project)).toBe(0)

      await expect(
        ensureGraphDaemonForProject(harness.project, 'electron', {
          bin: FAKE_BIN_COMMAND,
          timeoutMs: 2_000,
        }),
      ).rejects.toBeInstanceOf(UnsafeOwnerError)

      // (1) The innocent pid is STILL ALIVE — the protocol did not
      // SIGTERM/SIGKILL it. This is the load-bearing assertion: a real
      // user process should never be killed because of a stale owner
      // record.
      expect(isProcessAlive(innocentPid)).toBe(true)

      // (2) NO new vt-graphd child was spawned. Unsafe-owner means
      // "refuse, do not respawn".
      expect(countDaemonProcessesForProject(harness.project)).toBe(0)

      // (3) The owner record on disk is untouched — reclaim was refused
      // safely; the operator's stale record is preserved for diagnosis.
      const owner = await readPersistedOwner(harness.project)
      expect(owner.pid).toBe(innocentPid)
      expect(owner.ownerNonce).toBe(recordedNonce)
    },
    10_000,
  )
})

describe('BF-348 regression: lock-without-port does not fan out', () => {
  test(
    'alive in-flight owner (port=null, fresh heartbeat) with 50 concurrent callers → all wait + OwnerWaitTimeoutError, ZERO daemons spawned, in-flight pid untouched',
    async () => {
      // The "lock-without-port" condition: an owner claim exists, the
      // recorded pid is alive, but no port has been bound yet (port=null).
      // With a fresh heartbeat the protocol decision is `wait` — even
      // when the live command-line does not look like vt-graphd, because
      // fingerprint is only consulted on the stale-heartbeat branch.
      const inflight = spawnInnocentLongRunner(harness)
      const inflightPid = inflight.pid
      if (!inflightPid) throw new Error('inflight child failed to spawn')

      await writeOwnerRecord(harness.project, {
        pid: inflightPid,
        port: null,
        ownerNonce: 'in-flight-nonce',
        heartbeatAtMs: Date.now(),
        startedAtMs: Date.now(),
        // Non-vt-graphd fingerprint is FINE here: a fresh heartbeat
        // routes to `wait` before the fingerprint branch is even reached.
        commandFingerprint: {
          executable: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1e9)'],
        },
      })

      const callerCount = 50
      const start = Date.now()
      const settled = await Promise.allSettled(
        Array.from({ length: callerCount }, () =>
          ensureGraphDaemonForProject(harness.project, 'electron', {
            bin: FAKE_BIN_COMMAND,
            timeoutMs: 600,
          }),
        ),
      )
      const elapsed = Date.now() - start

      // (1) Every single caller surfaced OwnerWaitTimeoutError. None
      // succeeded (no daemon was ever produced), none surfaced
      // UnsafeOwnerError (fingerprint is only checked under stale
      // heartbeat).
      for (const outcome of settled) {
        expect(outcome.status).toBe('rejected')
        if (outcome.status === 'rejected') {
          expect(outcome.reason).toBeInstanceOf(OwnerWaitTimeoutError)
        }
      }

      // The timeout was 600ms — wall-clock should be at least that, and
      // bounded by a sensible upper limit so we know we actually waited
      // rather than bypassing the wait loop.
      expect(elapsed).toBeGreaterThanOrEqual(500)
      expect(elapsed).toBeLessThan(5_000)

      // (2) ZERO vt-graphd children visible to ps. This is the
      // anti-fork-storm invariant: 50 callers all noticed the
      // unhealthy owner and not ONE of them spawned a child.
      expect(countDaemonProcessesForProject(harness.project)).toBe(0)

      // (3) The in-flight pid is still alive — wait does not kill.
      expect(isProcessAlive(inflightPid)).toBe(true)

      // (4) Owner record is intact (still the original in-flight claim).
      const owner = await readPersistedOwner(harness.project)
      expect(owner.pid).toBe(inflightPid)
      expect(owner.ownerNonce).toBe('in-flight-nonce')
      expect(owner.port).toBeNull()
    },
    15_000,
  )
})
