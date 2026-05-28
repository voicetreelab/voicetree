/**
 * BF-374 regression: VTD stale-owner reclaim under storm.
 *
 * Four adversarial preconditions that the BF-348 decision rule must route
 * correctly. Each scenario is the vtd analogue of a graphd case (BF-342→348);
 * the differences are limited to the daemon kind, argv shape (`--vault`),
 * owner file (`vtd.owner.json`), and that VTD's spawn returns an
 * `authToken` field on the result.
 *
 *  - dead pid             — record's pid was reaped → `stale-reclaim` →
 *                           fresh spawn replaces the record atomically.
 *  - port unbound         — alive non-vtd pid + recorded port unreachable +
 *                           stale heartbeat + fingerprint mismatch →
 *                           `unsafe-owner: fingerprint-mismatch` → refuse.
 *  - nonce mismatch       — recorded port hosts a real `/health` server
 *                           whose ownerNonce does not match the record →
 *                           `unsafe-owner: health-identity-mismatch` → refuse.
 *  - heartbeat-stale +
 *    fingerprint match    — record points at a LIVE fake-vtd whose command
 *                           fingerprint matches but whose record was
 *                           rewritten with a stale heartbeat →
 *                           `stale-reclaim: stale-heartbeat` → reclaim
 *                           SIGTERMs the matching daemon, deletes the
 *                           record, spawns a fresh one.
 *
 * Observability is via the actual `ps` process count, the on-disk owner
 * record, and `process.kill(pid, 0)` liveness — never by inspecting
 * protocol internals (CLAUDE.md black-box rule).
 */

import { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { UnsafeOwnerError } from '@vt/daemon-lifecycle'
import { ensureVtDaemonForVault } from './harness/nodeEnsureVtDaemonForVault.ts'
import {
  FAKE_BIN,
  FAKE_BIN_COMMAND,
  countDaemonProcessesForVault,
  createHarness,
  deadPid,
  destroyHarness,
  fakeDaemonFingerprintFor,
  isProcessAlive,
  listDaemonPidsForVault,
  readPersistedOwner,
  spawnInnocentLongRunner,
  trackDaemonPid,
  trackSpawn,
  writeOwnerRecord,
  type Harness,
} from './harness/vtdOwnerStormHarness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness('vt-daemon-bf374-stale-')
})

afterEach(async () => {
  for (const pid of listDaemonPidsForVault(harness.vault)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
  await destroyHarness(harness)
})

describe.runIf(process.platform !== 'win32')(
  'BF-374 regression: VTD stale-owner reclaim',
  () => {
    test(
      'stale dead-pid owner + 100 concurrent callers → exactly one new daemon, all callers converge',
      async () => {
        const stalePid = await deadPid()
        const staleNonce = 'stale-dead-pid-nonce-bf374'

        await writeOwnerRecord(harness.vault, {
          pid: stalePid,
          port: null,
          ownerNonce: staleNonce,
          heartbeatAtMs: Date.now(),
          // Matching fingerprint isn't required when pid is dead: the
          // decision is stale-reclaim on the dead-pid branch regardless,
          // and we want the test to mirror what a real crashed daemon
          // would leave behind — a record whose recorded fingerprint
          // matches what vtd would have written for itself.
          commandFingerprint: fakeDaemonFingerprintFor(harness.vault),
        })

        const callCount = 100
        const results = await Promise.all(
          Array.from({ length: callCount }, () =>
            ensureVtDaemonForVault(harness.vault, 'electron', {
              bin: FAKE_BIN_COMMAND,
              timeoutMs: 10_000,
            }),
          ),
        )

        // (1) The stale nonce/pid are gone — the on-disk record now
        // reflects the freshly reclaimed owner.
        const owner = await readPersistedOwner(harness.vault)
        trackDaemonPid(harness, owner.pid)
        expect(owner.ownerNonce).not.toBe(staleNonce)
        expect(owner.pid).not.toBe(stalePid)
        expect(owner.port).not.toBeNull()
        expect(owner.daemonKind).toBe('vtd')

        // (2) Exactly ONE vtd child visible to ps. The dead pid was
        // never alive, so the count is the new daemon and nothing else.
        expect(countDaemonProcessesForVault(harness.vault)).toBe(1)

        // (3) All 100 callers converged on the same new owner.
        const ports = new Set(results.map((r) => r.port))
        const pids = new Set(results.map((r) => r.pid))
        const nonces = new Set(results.map((r) => r.ownerNonce))
        const tokens = new Set(results.map((r) => r.authToken))
        expect(ports.size).toBe(1)
        expect(pids.size).toBe(1)
        expect(nonces.size).toBe(1)
        expect(tokens.size).toBe(1)
        expect([...pids][0]).toBe(owner.pid)
        expect([...ports][0]).toBe(owner.port)
        expect([...nonces][0]).toBe(owner.ownerNonce)

        // (4) Sample-probe /health on a handful of clients — every probe
        // must hit the same reclaimed VTD identity.
        const sampleHealth = await Promise.all(
          results.slice(0, 5).map((r) => r.client.health()),
        )
        for (const body of sampleHealth) {
          expect(body.daemonKind).toBe('vtd')
          expect(body.owner?.ownerNonce).toBe(owner.ownerNonce)
          expect(body.owner?.port).toBe(owner.port)
        }
      },
      30_000,
    )

    test(
      'stale port-unbound + alive non-vtd pid + stale heartbeat → UnsafeOwnerError (fingerprint-mismatch), pid NOT killed',
      async () => {
        // Alive pid whose command-line is `node -e setInterval(...)` —
        // does NOT match the vtd fingerprint recorded below. Combined
        // with a stale heartbeat (older than the default 15s
        // staleHeartbeatMs) the protocol routes through the
        // heartbeat-stale branch and lands on `unsafe-owner:
        // fingerprint-mismatch`. The port we record is a fresh ephemeral
        // socket we then immediately close so it's unreachable — that
        // forces `health: 'unreachable'` so the verified/mismatch
        // branches are skipped.
        const innocent = spawnInnocentLongRunner(harness)
        const innocentPid = innocent.pid
        if (!innocentPid) throw new Error('innocent child failed to spawn')

        const unboundPort = await reservePortAndRelease()

        const staleHeartbeat = Date.now() - 60_000
        const recordedNonce = 'stale-port-unbound-nonce'
        await writeOwnerRecord(harness.vault, {
          pid: innocentPid,
          port: unboundPort,
          ownerNonce: recordedNonce,
          heartbeatAtMs: staleHeartbeat,
          startedAtMs: staleHeartbeat,
          // Recorded fingerprint claims to be a real vtd binary — the
          // live process is `node -e setInterval(...)` so the kernel-
          // observed command differs and the branch is fingerprint-
          // mismatch.
          commandFingerprint: fakeDaemonFingerprintFor(harness.vault),
        })

        expect(countDaemonProcessesForVault(harness.vault)).toBe(0)

        await expect(
          ensureVtDaemonForVault(harness.vault, 'electron', {
            bin: FAKE_BIN_COMMAND,
            timeoutMs: 2_000,
          }),
        ).rejects.toBeInstanceOf(UnsafeOwnerError)

        // (1) The innocent pid is STILL ALIVE — the protocol did not
        // SIGTERM/SIGKILL it. A real user process should never be killed
        // because of a stale owner record.
        expect(isProcessAlive(innocentPid)).toBe(true)

        // (2) NO new vtd child spawned. Unsafe-owner means refuse, do
        // not respawn.
        expect(countDaemonProcessesForVault(harness.vault)).toBe(0)

        // (3) Owner record on disk is untouched — reclaim was refused
        // safely; the operator's stale record is preserved for diagnosis.
        const owner = await readPersistedOwner(harness.vault)
        expect(owner.pid).toBe(innocentPid)
        expect(owner.ownerNonce).toBe(recordedNonce)
        expect(owner.port).toBe(unboundPort)
      },
      10_000,
    )

    test(
      'stale nonce mismatch (real fake-vtd serving /health with different nonce) → UnsafeOwnerError (health-identity-mismatch)',
      async () => {
        // Bring up a real fake-vtd configured to serve a DIFFERENT nonce
        // than what we record. The protocol's `probeOwnerHealth` will
        // verify the schema + observe `ownerNonce: 'served-by-fake'` and
        // compare it to the recorded `expected-nonce` — they differ, so
        // the branch is `unsafe-owner: health-identity-mismatch`.
        const servedNonce = 'served-by-fake'
        const recordedNonce = 'expected-nonce'

        const fakeChild = spawnFakeVtd(harness.vault, {
          FAKE_VTD_HEALTH_OWNER_NONCE: servedNonce,
        })
        trackSpawn(harness, fakeChild)
        if (!fakeChild.pid) throw new Error('fake-vtd failed to spawn')

        // Wait until the real fake-vtd has bound a port — it does this
        // by atomic-replacing the owner record with a non-null port. We
        // poll the on-disk record until port is set.
        const realRecord = await waitForBoundPort(harness.vault, 5_000)
        trackDaemonPid(harness, realRecord.pid)

        // Now OVERWRITE the owner record so it advertises the right
        // port but a different nonce. The protocol will probe /health
        // (since port is set), observe a verified body whose nonce
        // mismatches → unsafe-owner.
        await writeOwnerRecord(harness.vault, {
          pid: realRecord.pid,
          port: realRecord.port,
          ownerNonce: recordedNonce,
          heartbeatAtMs: Date.now(),
          commandFingerprint: fakeDaemonFingerprintFor(harness.vault),
        })

        await expect(
          ensureVtDaemonForVault(harness.vault, 'electron', {
            bin: FAKE_BIN_COMMAND,
            timeoutMs: 2_000,
          }),
        ).rejects.toBeInstanceOf(UnsafeOwnerError)

        // The fake-vtd is still alive — unsafe-owner refused to kill it.
        expect(isProcessAlive(realRecord.pid)).toBe(true)

        // Owner record is unchanged (the recorded nonce we wrote).
        const owner = await readPersistedOwner(harness.vault)
        expect(owner.ownerNonce).toBe(recordedNonce)
      },
      15_000,
    )

    test(
      'stale heartbeat + matching fingerprint (real fake-vtd never binds) → stale-reclaim SIGTERMs the matching daemon and spawns fresh',
      async () => {
        // Bring up a fake-vtd with an enormous startup delay so it
        // claims the owner record then hangs BEFORE binding the HTTP
        // port. The live process IS a real `node fake-vtd.mjs --vault X`
        // — its command fingerprint matches `fakeDaemonFingerprintFor`.
        const hungChild = spawnFakeVtd(harness.vault, {
          FAKE_VTD_STARTUP_DELAY_MS: '600000',
        })
        trackSpawn(harness, hungChild)
        if (!hungChild.pid) throw new Error('hung fake-vtd failed to spawn')

        // Wait until the hung fake-vtd has written its initial port-null
        // record. We DON'T wait for a bound port (it never binds).
        const initial = await waitForOwnerRecord(harness.vault, 5_000)
        const hungPid = initial.pid
        expect(hungPid).toBe(hungChild.pid)
        const initialNonce = initial.ownerNonce

        // Rewrite the record with a stale heartbeat. Live process is
        // the same fake-vtd; recorded fingerprint matches its actual
        // command line. Decision rule:
        //   pid alive + health unprobed (port=null) + heartbeat stale
        //   + fingerprintMatch === 'match' → stale-reclaim:stale-heartbeat
        const staleHeartbeat = Date.now() - 60_000
        await writeOwnerRecord(harness.vault, {
          pid: hungPid,
          port: null,
          ownerNonce: initialNonce,
          heartbeatAtMs: staleHeartbeat,
          startedAtMs: staleHeartbeat,
          commandFingerprint: fakeDaemonFingerprintFor(harness.vault),
        })

        // Confirm exactly one vtd-shaped process for this vault before
        // ensure runs (the hung fake-vtd itself).
        expect(countDaemonProcessesForVault(harness.vault)).toBe(1)

        const result = await ensureVtDaemonForVault(
          harness.vault,
          'electron',
          {
            bin: FAKE_BIN_COMMAND,
            timeoutMs: 10_000,
          },
        )
        trackDaemonPid(harness, result.pid)

        // (1) ensure launched a fresh daemon (not the hung one).
        expect(result.launched).toBe(true)
        expect(result.pid).not.toBe(hungPid)
        expect(result.ownerNonce).not.toBe(initialNonce)
        expect(result.port).toBeGreaterThan(0)

        // (2) The hung process is GONE — stale-reclaim SIGTERMed it.
        // Give it a brief grace window for the signal to be delivered.
        await waitForPidGone(hungPid, 2_000)
        expect(isProcessAlive(hungPid)).toBe(false)

        // (3) Owner record reflects the new daemon.
        const owner = await readPersistedOwner(harness.vault)
        expect(owner.pid).toBe(result.pid)
        expect(owner.port).toBe(result.port)
        expect(owner.ownerNonce).toBe(result.ownerNonce)

        // (4) Exactly ONE vtd child visible to ps (the fresh one).
        expect(countDaemonProcessesForVault(harness.vault)).toBe(1)
      },
      30_000,
    )
  },
)

// --- helpers -----------------------------------------------------------

import { createServer } from 'node:http'

function spawnFakeVtd(
  vault: string,
  env: Record<string, string>,
): ReturnType<typeof spawn> {
  return spawn(process.execPath, [FAKE_BIN, '--vault', vault], {
    stdio: 'ignore',
    env: { ...process.env, ...env },
    detached: false,
  })
}

/**
 * Allocate an ephemeral loopback port, then release it. The returned
 * port number is no longer bound — connections to it will refuse — but
 * the kernel will not immediately re-issue it within a TIME_WAIT window,
 * so the test can use it as a "known unbound" port for the protocol's
 * health probe to surface `unreachable`.
 */
async function reservePortAndRelease(): Promise<number> {
  const server = createServer()
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()))
  const addr = server.address()
  if (!addr || typeof addr !== 'object') {
    throw new Error('unable to allocate ephemeral port')
  }
  const port = addr.port
  await new Promise<void>((res) => server.close(() => res()))
  return port
}

/** Poll until `<vault>/.voicetree/vtd.owner.json` exists. */
async function waitForOwnerRecord(
  vault: string,
  timeoutMs: number,
): Promise<{ pid: number; port: number | null; ownerNonce: string }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const owner = await readPersistedOwner(vault)
      return {
        pid: owner.pid,
        port: owner.port,
        ownerNonce: owner.ownerNonce,
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      await new Promise((res) => setTimeout(res, 25))
    }
  }
  throw new Error(`owner record did not appear within ${timeoutMs}ms`)
}

/** Poll until the on-disk record carries a non-null port. */
async function waitForBoundPort(
  vault: string,
  timeoutMs: number,
): Promise<{ pid: number; port: number; ownerNonce: string }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const owner = await readPersistedOwner(vault)
      if (owner.port !== null) {
        return {
          pid: owner.pid,
          port: owner.port,
          ownerNonce: owner.ownerNonce,
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    await new Promise((res) => setTimeout(res, 25))
  }
  throw new Error(`owner record did not get a bound port within ${timeoutMs}ms`)
}

async function waitForPidGone(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return
    await new Promise((res) => setTimeout(res, 25))
  }
}
