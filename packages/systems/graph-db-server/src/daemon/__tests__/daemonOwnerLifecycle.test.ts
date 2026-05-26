/**
 * Black-box BF-343 tests for the server-side owner lifecycle.
 *
 * Scenarios mirror the spec under
 * brain/mem/openspec/changes/vt-graphd-single-owner-daemon/specs/daemon-ownership/spec.md:
 *
 *   - "Daemon cannot serve without matching owner" → race conflict throws
 *     and only one daemon binds for a single vault.
 *   - "Existing healthy owner is reused" (server side) → /health payload
 *     and on-disk owner record describe the same identity.
 *   - "Startup order is claim then ready" → owner record exists before any
 *     vault-scoped RPC is reachable (here: before the daemon returns from
 *     startDaemon).
 *   - Heartbeat refresh → heartbeatAtMs advances on the filesystem while
 *     the daemon is alive.
 *   - Graceful shutdown removes the owner record.
 *
 * All assertions are on observable outcomes: filesystem state, HTTP
 * payload, and typed errors. No internal mocks, no toHaveBeenCalledWith.
 */

import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { startDaemon, type DaemonHandle } from '../server.ts'
import { ownerRecordFile, readOwnerRecord } from '@vt/daemon-lifecycle'

function ownerRecordPathFor(vault: string, daemonKind: 'graphd' | 'vtd'): string {
  return ownerRecordFile.pathFor(vault, daemonKind)
}
import {
  DaemonOwnerConflictError,
  HEARTBEAT_INTERVAL_MS,
} from '../lifecycle/daemonOwnerLifecycle.ts'
import { HealthResponseSchema } from '@vt/graph-db-server/contract'

const TEST_TIMEOUT_MS = 30_000

describe('daemonOwnerLifecycle (black box)', () => {
  let vault: string
  let handles: DaemonHandle[] = []

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'vt-graphd-owner-bb-'))
    handles = []
  })

  afterEach(async () => {
    for (const h of handles) await h.stop().catch(() => {})
    await rm(vault, { recursive: true, force: true })
  })

  test(
    'first start writes an owner record that matches the /health payload',
    async () => {
      const handle = await startDaemon({ vault })
      handles.push(handle)

      const onDisk = await readOwnerRecord(ownerRecordPathFor(vault, 'graphd'))
      expect(onDisk).not.toBeNull()
      expect(onDisk?.canonicalVault).toBe(vault)
      expect(onDisk?.pid).toBe(process.pid)
      expect(onDisk?.port).toBe(handle.port)
      expect(onDisk?.ownerNonce).toEqual(expect.any(String))
      expect(onDisk?.ownerNonce.length).toBeGreaterThan(0)

      const res = await fetch(`http://127.0.0.1:${handle.port}/health`)
      const health = HealthResponseSchema.parse(await res.json())
      expect(health.owner).not.toBeNull()
      expect(health.owner?.canonicalVault).toBe(onDisk?.canonicalVault)
      expect(health.owner?.ownerNonce).toBe(onDisk?.ownerNonce)
      expect(health.owner?.pid).toBe(onDisk?.pid)
      expect(health.owner?.ppid).toBe(onDisk?.ppid)
      expect(health.owner?.port).toBe(onDisk?.port)
      expect(health.owner?.schemaVersion).toBe(1)
      expect(health.owner?.contractVersion).toBe(onDisk?.contractVersion)
    },
    TEST_TIMEOUT_MS,
  )

  test(
    'two daemons racing on one vault: exactly one becomes owner, the other gets a typed conflict',
    async () => {
      const settled = await Promise.allSettled([
        startDaemon({ vault }),
        startDaemon({ vault }),
      ])

      const winners = settled.filter(
        (r): r is PromiseFulfilledResult<DaemonHandle> => r.status === 'fulfilled',
      )
      const losers = settled.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      )

      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(1)
      handles.push(winners[0].value)

      const reason = losers[0].reason
      expect(reason).toBeInstanceOf(DaemonOwnerConflictError)
      const conflict = reason as DaemonOwnerConflictError
      expect(conflict.canonicalVault).toBe(vault)
      expect(conflict.existingOwner.pid).toBe(process.pid)

      // Winner remains healthy and is the sole listener.
      const probe = await fetch(`http://127.0.0.1:${winners[0].value.port}/health`)
      expect(probe.status).toBe(200)

      // Owner record on disk reflects the winner's identity.
      const onDisk = await readOwnerRecord(ownerRecordPathFor(vault, 'graphd'))
      expect(onDisk?.port).toBe(winners[0].value.port)
    },
    TEST_TIMEOUT_MS,
  )

  test(
    'a second startDaemon while the first is alive throws DaemonOwnerConflictError without touching the live daemon',
    async () => {
      const first = await startDaemon({ vault })
      handles.push(first)

      const portBefore = (await readOwnerRecord(ownerRecordPathFor(vault, 'graphd')))?.port

      await expect(startDaemon({ vault })).rejects.toBeInstanceOf(
        DaemonOwnerConflictError,
      )

      // Owner record is unchanged: the loser did NOT overwrite the winner.
      const onDiskAfter = await readOwnerRecord(ownerRecordPathFor(vault, 'graphd'))
      expect(onDiskAfter?.port).toBe(portBefore)
      // First daemon still serves traffic.
      const probe = await fetch(`http://127.0.0.1:${first.port}/health`)
      expect(probe.status).toBe(200)
    },
    TEST_TIMEOUT_MS,
  )

  test(
    'graceful stop deletes the owner record file',
    async () => {
      const handle = await startDaemon({ vault })
      handles.push(handle)

      // Sanity: present after start.
      await stat(ownerRecordPathFor(vault, 'graphd'))

      await handle.stop()
      handles = handles.filter((h) => h !== handle)

      await expect(stat(ownerRecordPathFor(vault, 'graphd'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
      expect(await readOwnerRecord(ownerRecordPathFor(vault, 'graphd'))).toBeNull()
    },
    TEST_TIMEOUT_MS,
  )

  test(
    'heartbeat advances heartbeatAtMs on disk while the daemon is alive',
    async () => {
      const handle = await startDaemon({ vault })
      handles.push(handle)

      const initial = await readOwnerRecord(ownerRecordPathFor(vault, 'graphd'))
      expect(initial).not.toBeNull()
      const initialHeartbeat = initial!.heartbeatAtMs

      // Wait one full heartbeat interval plus jitter; the timer should have
      // fired at least once and atomically rewritten the record.
      const deadline = Date.now() + HEARTBEAT_INTERVAL_MS * 4
      let observed: number = initialHeartbeat
      while (Date.now() < deadline) {
        const probe = await readOwnerRecord(ownerRecordPathFor(vault, 'graphd'))
        if (probe && probe.heartbeatAtMs > initialHeartbeat) {
          observed = probe.heartbeatAtMs
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      expect(observed).toBeGreaterThan(initialHeartbeat)
    },
    TEST_TIMEOUT_MS,
  )

  test(
    'after stop, a fresh startDaemon for the same vault succeeds and claims a new nonce',
    async () => {
      const first = await startDaemon({ vault })
      const firstNonce = (await readOwnerRecord(ownerRecordPathFor(vault, 'graphd')))?.ownerNonce
      await first.stop()

      const second = await startDaemon({ vault })
      handles.push(second)
      const secondRecord = await readOwnerRecord(ownerRecordPathFor(vault, 'graphd'))
      expect(secondRecord).not.toBeNull()
      expect(secondRecord?.pid).toBe(process.pid)
      expect(secondRecord?.port).toBe(second.port)
      // Nonces are per-claim, so a fresh start must mint a new one.
      expect(secondRecord?.ownerNonce).not.toBe(firstNonce)
    },
    TEST_TIMEOUT_MS,
  )
})
