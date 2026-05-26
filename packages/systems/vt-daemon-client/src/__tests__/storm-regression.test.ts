/**
 * BF-374 regression: VTD fork-storm.
 *
 * Sibling of `packages/systems/graph-db-client/src/__tests__/storm-regression.test.ts`
 * — same shape, mechanically lifted, swapping graphd-isms (`ensureGraphDaemonForVault`,
 * `--project-root`, `graphd.owner.json`) for vtd-isms (`ensureVtDaemonForVault`,
 * `--vault`, `vtd.owner.json`). BF-369 factored the orchestrator into a single
 * shared `attemptSpawnAndWait`, so both daemons inherit the same single-flight +
 * spawn-lock arbitration. This file asserts VTD's instantiation of that protocol
 * holds the same invariants the graphd regression locks in for graphd.
 *
 * Why the assertions are by `ps` and not by inspecting the result-set: a
 * single-flight cache could return the same pid 100 times WITHOUT actually
 * preventing spawns. The fork-storm assertion is observable iff we count
 * processes by command fingerprint via `ps` (Gotcha 2 of BF-348).
 *
 *  - Test A: 100 concurrent ensureVtDaemonForVault calls from one process →
 *    exactly ONE vtd child visible to `ps`.
 *  - Test B: N concurrent ensureVtDaemonForVault calls each in a separate Node
 *    child → exactly ONE vtd child visible to `ps`, no caller shares in-process
 *    single-flight state — the cross-process spawn lock is what's under test.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ensureVtDaemonForVault } from '../index.ts'
import {
  FAKE_BIN_COMMAND,
  countDaemonProcessesForVault,
  createHarness,
  destroyHarness,
  listDaemonPidsForVault,
  readPersistedOwner,
  trackDaemonPid,
  type Harness,
} from './harness/vtdOwnerStormHarness.ts'

const requireFromHere = createRequire(import.meta.url)
const TSX_LOADER = requireFromHere.resolve('tsx')
const ENSURE_CHILD = requireFromHere.resolve(
  './fixtures/ensure-vtd-child.mjs',
)

let harness: Harness

beforeEach(async () => {
  harness = await createHarness('vt-daemon-bf374-storm-')
})

afterEach(async () => {
  // Belt-and-braces: any vtd child we missed gets SIGKILLed via
  // listDaemonPidsForVault before the temp vault is removed.
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
  'BF-374 regression: VTD fork-storm',
  () => {
    test(
      'in-process: 100 concurrent ensureVtDaemonForVault calls produce exactly one vtd child',
      async () => {
        const callCount = 100

        const results = await Promise.all(
          Array.from({ length: callCount }, () =>
            ensureVtDaemonForVault(harness.vault, 'electron', {
              bin: FAKE_BIN_COMMAND,
              timeoutMs: 10_000,
            }),
          ),
        )

        // (1) Exactly ONE healthy owner record on disk — direct atomic-IO
        // read, decoded as a `daemonKind === 'vtd'` record (the harness's
        // `readPersistedOwner` enforces that discriminant).
        const owner = await readPersistedOwner(harness.vault)
        trackDaemonPid(harness, owner.pid)
        expect(owner.port).not.toBeNull()
        expect(owner.canonicalVault).toBe(resolve(harness.vault))
        expect(owner.daemonKind).toBe('vtd')

        // (2) `/health` reports the matching ownerNonce and `daemonKind: 'vtd'`.
        // The VtDaemonClient validates the response against
        // VtDaemonHealthResponseSchema, so a graphd-shaped body would have
        // thrown rather than passed this assertion.
        const health = await results[0].client.health()
        expect(health.daemonKind).toBe('vtd')
        expect(health.owner).not.toBeNull()
        expect(health.owner?.ownerNonce).toBe(owner.ownerNonce)
        expect(health.owner?.port).toBe(owner.port)

        // (3) Exactly ONE vtd child process visible to ps for this vault.
        // This is the direct fork-storm assertion: a single-flight cache
        // could return identical pid/port to all 100 callers WITHOUT
        // actually preventing spawns, so we count by command fingerprint.
        const liveDaemonCount = countDaemonProcessesForVault(harness.vault)
        expect(liveDaemonCount).toBe(1)

        // (4) The 100 returned VtDaemonClients all bind to that one port,
        // share one pid, share one ownerNonce, share one authToken (the
        // bearer the daemon published is single — N callers must NOT each
        // see a freshly-minted token).
        const ports = new Set(results.map((r) => r.port))
        const pids = new Set(results.map((r) => r.pid))
        const nonces = new Set(results.map((r) => r.ownerNonce))
        const tokens = new Set(results.map((r) => r.authToken))
        expect(ports.size).toBe(1)
        expect(pids.size).toBe(1)
        expect(nonces.size).toBe(1)
        expect(tokens.size).toBe(1)
        expect([...ports][0]).toBe(owner.port)
        expect([...pids][0]).toBe(owner.pid)

        // (5) Sample HTTP requests truly hit the same daemon — probe a
        // sample through the actual HTTP surface, not just the cached
        // result.
        const sampleHealth = await Promise.all(
          results.slice(0, 10).map((r) => r.client.health()),
        )
        for (const body of sampleHealth) {
          expect(body.vault).toBe(resolve(harness.vault))
          expect(body.owner?.ownerNonce).toBe(owner.ownerNonce)
          expect(body.owner?.port).toBe(owner.port)
          expect(body.daemonKind).toBe('vtd')
        }
      },
      30_000,
    )

    test(
      'cross-process: N separate Node processes racing on the same vault produce exactly one vtd child',
      async () => {
        // The in-process single-flight does not span Node processes; this
        // test exercises the filesystem spawn lock + claim arbitration.
        // 6 is chosen so the test finishes well under timeout but still
        // races more than the OS-page-cache flush window for the lock file
        // (Gotcha 5). Do NOT shrink below 6 — below that threshold the
        // test may pass even on a broken protocol.
        const processCount = 6
        const childTimeoutMs = 12_000

        const children = Array.from({ length: processCount }, () =>
          spawnEnsureChild(harness.vault, childTimeoutMs),
        )
        const outcomes = await Promise.all(children.map(collectChildOutcome))

        // Every child must have succeeded — none should have surfaced an
        // OwnerWaitTimeoutError, UnsafeOwnerError, etc.
        for (const outcome of outcomes) {
          expect(outcome.ok).toBe(true)
        }
        const oks = outcomes.filter(
          (o): o is ChildSuccess => o.ok === true,
        )
        expect(oks).toHaveLength(processCount)

        // (1) All N child processes returned the same port / pid / nonce.
        // authToken too — every caller must see the SAME bearer for the
        // single live daemon (a freshly-minted token per caller would
        // indicate divergence we're trying to prevent).
        const ports = new Set(oks.map((o) => o.port))
        const pids = new Set(oks.map((o) => o.pid))
        const nonces = new Set(oks.map((o) => o.ownerNonce))
        const tokens = new Set(oks.map((o) => o.authToken))
        expect(ports.size).toBe(1)
        expect(pids.size).toBe(1)
        expect(nonces.size).toBe(1)
        expect(tokens.size).toBe(1)

        // (2) Exactly ONE owner record on disk.
        const owner = await readPersistedOwner(harness.vault)
        trackDaemonPid(harness, owner.pid)
        expect(owner.pid).toBe([...pids][0])
        expect(owner.port).toBe([...ports][0])
        expect(owner.ownerNonce).toBe([...nonces][0])

        // (3) Exactly ONE vtd child visible to ps for this vault.
        const liveDaemonCount = countDaemonProcessesForVault(harness.vault)
        expect(liveDaemonCount).toBe(1)

        // (4) The cross-process invariant: at most ONE child reported
        // `launched=true` (the winner of the spawn lock). The rest reused
        // or waited. Per Gotcha 8: `<=1`, never `=== 1` — zero winners is
        // valid when reuse fires before any caller hits the claim branch.
        const launchedCount = oks.filter((o) => o.launched).length
        expect(launchedCount).toBeLessThanOrEqual(1)
      },
      45_000,
    )
  },
)

type ChildSuccess = {
  readonly ok: true
  readonly port: number
  readonly pid: number
  readonly ownerNonce: string
  readonly authToken: string
  readonly launched: boolean
}

type ChildFailure = {
  readonly ok: false
  readonly errorName: string
  readonly errorMessage: string
}

type ChildOutcome = ChildSuccess | ChildFailure

function spawnEnsureChild(vault: string, timeoutMs: number): ChildProcess {
  return spawn(
    process.execPath,
    [
      '--import',
      TSX_LOADER,
      ENSURE_CHILD,
      '--vault',
      vault,
      '--bin',
      FAKE_BIN_COMMAND,
      '--timeoutMs',
      String(timeoutMs),
      '--caller',
      'electron',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

async function collectChildOutcome(child: ChildProcess): Promise<ChildOutcome> {
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
  child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk))

  const exitCode = await new Promise<number | null>((res) => {
    child.once('exit', (code) => res(code))
  })

  const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim()
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
  const lastLine = stdout.split('\n').filter((l) => l.length > 0).at(-1)
  if (!lastLine) {
    return {
      ok: false,
      errorName: 'NoOutput',
      errorMessage: `child exited ${exitCode}, stderr=${stderr}`,
    }
  }
  try {
    return JSON.parse(lastLine) as ChildOutcome
  } catch {
    return {
      ok: false,
      errorName: 'BadJson',
      errorMessage: `unparseable line: ${lastLine} (stderr=${stderr})`,
    }
  }
}
