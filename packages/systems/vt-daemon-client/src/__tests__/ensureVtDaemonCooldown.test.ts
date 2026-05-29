/**
 * BF-374 regression: VTD spawn-cooldown breadcrumb.
 *
 * Mirrors `ensureGraphDaemonCooldown.test.ts` for graphd. The cooldown
 * breadcrumb is daemon-kind-scoped — VTD writes to
 * `<project>/.voicetree/vtd.cooldown.json`, graphd to `graphd.cooldown.json`
 * — so the two daemons cannot pollute each other's cooldown state.
 *
 *  - active cooldown blocks claim
 *      Pre-write `vtd.cooldown.json` with `untilMs: now + 60s`. ensure
 *      throws `OwnerSpawnCooldownError` immediately; no spawn fires;
 *      `vtd.owner.json` is never touched.
 *
 *  - expired cooldown allows spawn
 *      Pre-write a cooldown that's already expired. ensure proceeds,
 *      spawns the fake-vtd, and the breadcrumb is cleared on success.
 *
 *  - failed spawn writes cooldown
 *      Point `bin` at a fake-vtd configured to immediately
 *      `process.exit(1)` (via `FAKE_VTD_EXIT_CODE=1`). ensure surfaces a
 *      DaemonLaunchTimeout (or similar) and the cooldown breadcrumb is
 *      written with `untilMs ≈ now + spawnCooldownMs`.
 *
 * No internal mocks — every assertion lands on filesystem contents,
 * error types, or process counts (CLAUDE.md black-box rule).
 */

import { writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  cooldownBreadcrumbPathFor,
  OwnerSpawnCooldownError,
  readCooldownBreadcrumb,
} from '@vt/daemon-lifecycle'
import { ensureVtDaemonForProject } from './harness/nodeEnsureVtDaemonForProject.ts'
import {
  FAKE_BIN_COMMAND,
  countDaemonProcessesForProject,
  createHarness,
  destroyHarness,
  listDaemonPidsForProject,
  readPersistedOwnerOrNull,
  trackDaemonPid,
  type Harness,
} from './harness/vtdOwnerStormHarness.ts'

let harness: Harness

beforeEach(async () => {
  harness = await createHarness('vt-daemon-bf374-cd-')
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

describe.runIf(process.platform !== 'win32')(
  'BF-374 regression: VTD spawn cooldown breadcrumb',
  () => {
    test(
      'active cooldown blocks claim — ensure throws OwnerSpawnCooldownError without spawning',
      async () => {
        const now = Date.now()
        const breadcrumb = {
          schemaVersion: 1 as const,
          canonicalProject: harness.project,
          writtenAtMs: now,
          untilMs: now + 60_000,
          reason: 'test-injected-active',
          writerCallerKind: 'test' as const,
          writerPid: process.pid,
          lastErrorName: 'DaemonLaunchTimeout',
          lastErrorMessage: 'synthetic — never spawned',
        }
        await writeFile(
          cooldownBreadcrumbPathFor(harness.project, 'vtd'),
          `${JSON.stringify(breadcrumb, null, 2)}\n`,
          'utf8',
        )

        await expect(
          ensureVtDaemonForProject(harness.project, 'electron', {
            bin: FAKE_BIN_COMMAND,
            timeoutMs: 2_000,
          }),
        ).rejects.toBeInstanceOf(OwnerSpawnCooldownError)

        // No owner record was written — the protocol short-circuited
        // before any spawn attempt.
        const owner = await readPersistedOwnerOrNull(harness.project)
        expect(owner).toBeNull()

        // No vtd child visible to ps.
        expect(countDaemonProcessesForProject(harness.project)).toBe(0)

        // Breadcrumb is still on disk (we did not clear it).
        const cooldown = await readCooldownBreadcrumb(harness.project, 'vtd')
        expect(cooldown).not.toBeNull()
        expect(cooldown!.reason).toBe('test-injected-active')
      },
      10_000,
    )

    test(
      'expired cooldown allows spawn — ensure proceeds and breadcrumb is cleared on success',
      async () => {
        const now = Date.now()
        const breadcrumb = {
          schemaVersion: 1 as const,
          canonicalProject: harness.project,
          writtenAtMs: now - 60_000,
          untilMs: now - 1_000,
          reason: 'test-injected-expired',
          writerCallerKind: 'test' as const,
          writerPid: process.pid,
          lastErrorName: 'DaemonLaunchTimeout',
          lastErrorMessage: 'synthetic — already expired',
        }
        await writeFile(
          cooldownBreadcrumbPathFor(harness.project, 'vtd'),
          `${JSON.stringify(breadcrumb, null, 2)}\n`,
          'utf8',
        )

        const result = await ensureVtDaemonForProject(harness.project, 'electron', {
          bin: FAKE_BIN_COMMAND,
          timeoutMs: 10_000,
          spawnCooldownMs: 5_000,
        })
        trackDaemonPid(harness, result.pid)

        expect(result.launched).toBe(true)
        expect(result.port).toBeGreaterThan(0)

        // The successful spawn cleared the breadcrumb.
        const cleared = await readCooldownBreadcrumb(harness.project, 'vtd')
        expect(cleared).toBeNull()
      },
      15_000,
    )

    test(
      'failed spawn writes cooldown — ensure rejects and vtd.cooldown.json appears with untilMs ≈ now + spawnCooldownMs',
      async () => {
        // FAKE_VTD_EXIT_CODE=1 makes the fake daemon exit before
        // claiming the owner record. The ensure path's wait-for-health
        // loop should time out and write the cooldown breadcrumb.
        const spawnCooldownMs = 30_000
        const startMs = Date.now()
        await expect(
          ensureVtDaemonForProject(harness.project, 'electron', {
            bin: `env FAKE_VTD_EXIT_CODE=1 ${FAKE_BIN_COMMAND}`,
            timeoutMs: 2_000,
            spawnCooldownMs,
            initialBackoffMs: 25,
            maxBackoffMs: 50,
          }),
        ).rejects.toThrow()

        const breadcrumb = await readCooldownBreadcrumb(harness.project, 'vtd')
        expect(breadcrumb).not.toBeNull()
        expect(breadcrumb!.canonicalProject).toBe(harness.project)
        expect(breadcrumb!.untilMs).toBeGreaterThan(Date.now())
        // The window is approximately `now + spawnCooldownMs` — allow a
        // generous lower bound to swallow scheduling jitter.
        expect(breadcrumb!.untilMs).toBeGreaterThanOrEqual(
          startMs + spawnCooldownMs - 2_000,
        )
        expect(breadcrumb!.untilMs).toBeLessThanOrEqual(
          Date.now() + spawnCooldownMs + 1_000,
        )

        // No vtd child running.
        expect(countDaemonProcessesForProject(harness.project)).toBe(0)
      },
      15_000,
    )
  },
)
