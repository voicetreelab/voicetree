/**
 * BF-374 regression: VTD unsafe-owner refusal.
 *
 * Three adversarial preconditions in which the recorded owner record
 * does NOT belong to the VTD it claims to. The protocol must refuse to
 * reclaim — refuse to SIGTERM the recorded pid AND refuse to spawn a
 * replacement (the May-22 fork-storm's "vault_not_open cascade" failure
 * mode is precisely the absence of these refusals).
 *
 *  - live pid + mismatched fingerprint
 *      Recorded pid is alive but is a `node -e setInterval(...)` child
 *      with a non-vtd command line. Heartbeat is stale. Decision:
 *      `unsafe-owner: fingerprint-mismatch`. Innocent process must
 *      survive; no new daemon spawned.
 *
 *  - /health identity verified but different
 *      A real fake-vtd is on the recorded port and answers /health
 *      perfectly — but with a different ownerNonce than the record.
 *      Decision: `unsafe-owner: health-identity-mismatch`. Fake-vtd
 *      must survive (we recorded the wrong identity, not them).
 *
 *  - port reused by unrelated HTTP server
 *      A plain `http.createServer` is on the recorded port. It answers
 *      with 404 for `/health`. The protocol's health probe returns
 *      `unreachable`. With a stale heartbeat + non-matching command
 *      fingerprint the decision is `unsafe-owner:
 *      fingerprint-mismatch` (the recorded-pid command differs from
 *      what was recorded). The unrelated server must survive.
 *
 * All assertions resolve to observable boundaries: on-disk owner
 * record, `process.kill(pid, 0)` liveness, and `ps`-based process
 * counts — never inspection of protocol internals.
 */

import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { UnsafeOwnerError } from '@vt/daemon-lifecycle'
import { ensureVtDaemonForVault } from './harness/nodeEnsureVtDaemonForVault.ts'
import {
  FAKE_BIN,
  FAKE_BIN_COMMAND,
  countDaemonProcessesForVault,
  createHarness,
  destroyHarness,
  isProcessAlive,
  listDaemonPidsForVault,
  readPersistedOwner,
  spawnInnocentLongRunner,
  trackDaemonPid,
  trackSpawn,
  writeOwnerRecord,
  type Harness,
} from './harness/vtdOwnerStormHarness.ts'

import { spawn } from 'node:child_process'

let harness: Harness
const httpServers: Server[] = []

beforeEach(async () => {
  harness = await createHarness('vt-daemon-bf374-unsafe-')
})

afterEach(async () => {
  for (const server of httpServers.splice(0)) {
    await new Promise<void>((res) => server.close(() => res()))
  }
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
  'BF-374 regression: VTD unsafe-owner refusal',
  () => {
    test(
      'live pid with mismatched command fingerprint + stale heartbeat → UnsafeOwnerError, pid NOT killed',
      async () => {
        const innocent = spawnInnocentLongRunner(harness)
        const innocentPid = innocent.pid
        if (!innocentPid) throw new Error('innocent child failed to spawn')

        // Stale heartbeat puts us on the fingerprint branch. Recorded
        // fingerprint claims a vtd executable; live process is
        // `node -e setInterval(...)` — they differ → fingerprint-mismatch.
        const staleHeartbeat = Date.now() - 60_000
        const recordedNonce = 'unsafe-fingerprint-nonce'
        await writeOwnerRecord(harness.vault, {
          pid: innocentPid,
          port: null,
          ownerNonce: recordedNonce,
          heartbeatAtMs: staleHeartbeat,
          startedAtMs: staleHeartbeat,
          commandFingerprint: {
            executable: process.execPath,
            args: [
              '/opt/voicetree/vtd.mjs',
              '--vault',
              harness.vault,
            ],
          },
        })

        expect(countDaemonProcessesForVault(harness.vault)).toBe(0)

        await expect(
          ensureVtDaemonForVault(harness.vault, 'electron', {
            bin: FAKE_BIN_COMMAND,
            timeoutMs: 2_000,
          }),
        ).rejects.toBeInstanceOf(UnsafeOwnerError)

        // The innocent pid is STILL ALIVE — the load-bearing assertion.
        expect(isProcessAlive(innocentPid)).toBe(true)

        // No new vtd child was spawned.
        expect(countDaemonProcessesForVault(harness.vault)).toBe(0)

        // Owner record on disk is untouched.
        const owner = await readPersistedOwner(harness.vault)
        expect(owner.pid).toBe(innocentPid)
        expect(owner.ownerNonce).toBe(recordedNonce)
      },
      10_000,
    )

    test(
      'live fake-vtd serving /health with different ownerNonce → UnsafeOwnerError (health-identity-mismatch), fake-vtd survives',
      async () => {
        // Bring up a real fake-vtd configured to serve nonce Y; then
        // overwrite the recorded record to claim nonce X. The protocol
        // observes verified-but-different → unsafe-owner.
        const servedNonce = 'served-by-fake'
        const recordedNonce = 'recorded-but-wrong'

        const fakeChild = spawn(
          process.execPath,
          [FAKE_BIN, '--vault', harness.vault],
          {
            stdio: 'ignore',
            env: {
              ...process.env,
              FAKE_VTD_HEALTH_OWNER_NONCE: servedNonce,
            },
            detached: false,
          },
        )
        trackSpawn(harness, fakeChild)
        if (!fakeChild.pid) throw new Error('fake-vtd failed to spawn')

        const realRecord = await waitForBoundPort(harness.vault, 5_000)
        trackDaemonPid(harness, realRecord.pid)

        await writeOwnerRecord(harness.vault, {
          pid: realRecord.pid,
          port: realRecord.port,
          ownerNonce: recordedNonce,
          heartbeatAtMs: Date.now(),
          commandFingerprint: {
            executable: process.execPath,
            args: [FAKE_BIN, '--vault', harness.vault],
          },
        })

        await expect(
          ensureVtDaemonForVault(harness.vault, 'electron', {
            bin: FAKE_BIN_COMMAND,
            timeoutMs: 2_000,
          }),
        ).rejects.toBeInstanceOf(UnsafeOwnerError)

        // The real fake-vtd is STILL ALIVE — unsafe-owner refused to
        // SIGTERM it because we cannot prove it's the daemon we recorded.
        expect(isProcessAlive(realRecord.pid)).toBe(true)
        expect(countDaemonProcessesForVault(harness.vault)).toBe(1)

        // Owner record is unchanged (carries our overwritten nonce).
        const owner = await readPersistedOwner(harness.vault)
        expect(owner.ownerNonce).toBe(recordedNonce)
      },
      15_000,
    )

    test(
      'port reused by unrelated HTTP server + alive recording pid + stale heartbeat → UnsafeOwnerError (fingerprint-mismatch), unrelated server survives',
      async () => {
        // An unrelated HTTP server is on the recorded port. It returns
        // 404 for /health (not the VtDaemonHealthResponse shape), so
        // `probeOwnerHealth` reports `unreachable`. The recorded pid is
        // an alive non-vtd process (our innocent long-runner). With a
        // stale heartbeat + fingerprint mismatch the decision is
        // `unsafe-owner: fingerprint-mismatch`.
        const unrelatedPort = await startUnrelatedHttpServer()
        const innocent = spawnInnocentLongRunner(harness)
        const innocentPid = innocent.pid
        if (!innocentPid) throw new Error('innocent child failed to spawn')

        const staleHeartbeat = Date.now() - 60_000
        const recordedNonce = 'port-reused-unrelated-nonce'
        await writeOwnerRecord(harness.vault, {
          pid: innocentPid,
          port: unrelatedPort,
          ownerNonce: recordedNonce,
          heartbeatAtMs: staleHeartbeat,
          startedAtMs: staleHeartbeat,
          commandFingerprint: {
            executable: process.execPath,
            args: [FAKE_BIN, '--vault', harness.vault],
          },
        })

        expect(countDaemonProcessesForVault(harness.vault)).toBe(0)

        await expect(
          ensureVtDaemonForVault(harness.vault, 'electron', {
            bin: FAKE_BIN_COMMAND,
            timeoutMs: 2_000,
          }),
        ).rejects.toBeInstanceOf(UnsafeOwnerError)

        // The innocent recording pid survives.
        expect(isProcessAlive(innocentPid)).toBe(true)

        // The unrelated HTTP server is still serving — we'd close it in
        // afterEach. If the protocol had bound its own HTTP server on the
        // same port, the second listen would EADDRINUSE; the fact that
        // no vtd child was spawned (per the ps count below) proves the
        // unrelated server's port stays exclusively theirs.
        expect(countDaemonProcessesForVault(harness.vault)).toBe(0)

        const owner = await readPersistedOwner(harness.vault)
        expect(owner.pid).toBe(innocentPid)
        expect(owner.port).toBe(unrelatedPort)
        expect(owner.ownerNonce).toBe(recordedNonce)
      },
      10_000,
    )
  },
)

async function startUnrelatedHttpServer(): Promise<number> {
  const server = createServer((_req, res) => {
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()))
  httpServers.push(server)
  const addr = server.address()
  if (!addr || typeof addr !== 'object') {
    throw new Error('unable to bind unrelated http server')
  }
  return addr.port
}

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
