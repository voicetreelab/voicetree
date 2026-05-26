/**
 * Black-box BF-370 tests for the VTD owner lifecycle.
 *
 * Assertions are on observable side effects only — the on-disk owner record
 * file and the values the public handle returns. No internal mocks, no
 * spying on private functions, no toHaveBeenCalledWith. The lifecycle is
 * exercised exactly the way a real launcher (BF-371's `bin/vtd.ts`) will
 * exercise it.
 */

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
    ownerRecordFile,
    readOwnerRecord,
    type CallerKind,
    type CommandFingerprint,
    type OwnerRecord,
} from '@vt/daemon-lifecycle'
import { VTD_CONTRACT_VERSION } from '../../contract.ts'
import {
    claimVtDaemonOwner,
    VtDaemonOwnerConflictError,
    type VtDaemonOwnerHandle,
} from '../vtDaemonOwnerLifecycle.ts'

const TEST_TIMEOUT_MS = 15_000

const DEFAULT_CALLER_KIND: CallerKind = 'test'
const DEFAULT_FINGERPRINT: CommandFingerprint = {
    executable: process.execPath,
    args: ['vt-daemon-test'],
} as const

async function makeVault(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'vtd-owner-bb-'))
    await mkdir(join(dir, '.voicetree'), { recursive: true })
    return dir
}

async function claim(
    vault: string,
    overrides: Partial<Parameters<typeof claimVtDaemonOwner>[0]> = {},
): Promise<VtDaemonOwnerHandle> {
    return claimVtDaemonOwner({
        canonicalVault: vault,
        callerKind: DEFAULT_CALLER_KIND,
        contractVersion: VTD_CONTRACT_VERSION,
        commandFingerprint: DEFAULT_FINGERPRINT,
        clock: () => Date.now(),
        ...overrides,
    })
}

/** Spawn-and-reap to obtain a pid we know is no longer alive. */
async function deadPid(): Promise<number> {
    const child = spawn(process.execPath, ['-e', 'process.exit(0)'])
    await new Promise<void>((res) => child.once('exit', () => res()))
    if (!child.pid) throw new Error('unable to obtain reaped pid')
    return child.pid
}

async function writeRecordRaw(
    vault: string,
    daemonKind: 'vtd' | 'graphd',
    overrides: Partial<OwnerRecord> = {},
): Promise<OwnerRecord> {
    const path = ownerRecordFile.pathFor(vault, daemonKind)
    const base: OwnerRecord = {
        schemaVersion: 1,
        daemonKind,
        canonicalVault: vault,
        pid: process.pid,
        ppid: process.ppid ?? 0,
        port: null,
        ownerNonce: 'preexisting-nonce',
        startedAtMs: Date.now(),
        heartbeatAtMs: Date.now(),
        callerKind: 'test',
        contractVersion: daemonKind === 'vtd' ? VTD_CONTRACT_VERSION : '0.2.0',
        commandFingerprint: DEFAULT_FINGERPRINT,
        ...overrides,
    }
    await writeFile(path, ownerRecordFile.encode(base), 'utf8')
    return base
}

describe('claimVtDaemonOwner (black box)', () => {
    let vault: string
    let handles: VtDaemonOwnerHandle[] = []

    beforeEach(async () => {
        vault = await makeVault()
        handles = []
    })

    afterEach(async () => {
        for (const h of handles) await h.release().catch(() => {})
        await rm(vault, { recursive: true, force: true })
    })

    test(
        'writes <vault>/.voicetree/vtd.owner.json with the documented shape',
        async () => {
            const handle = await claim(vault)
            handles.push(handle)

            const ownerPath = ownerRecordFile.pathFor(vault, 'vtd')
            const onDisk = await readOwnerRecord(ownerPath)
            expect(onDisk).not.toBeNull()
            expect(onDisk?.daemonKind).toBe('vtd')
            expect(onDisk?.canonicalVault).toBe(vault)
            expect(onDisk?.pid).toBe(process.pid)
            expect(onDisk?.port).toBeNull()
            expect(onDisk?.contractVersion).toBe(VTD_CONTRACT_VERSION)
            expect(typeof onDisk?.ownerNonce).toBe('string')
            expect((onDisk?.ownerNonce ?? '').length).toBeGreaterThan(0)
            expect(onDisk?.schemaVersion).toBe(1)

            // No legacy lock sidecar — VTD has no BF-343→BF-344 transition.
            await expect(
                stat(join(vault, '.voicetree', 'vtd.lock')),
            ).rejects.toMatchObject({ code: 'ENOENT' })
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'bindPort(N) updates the on-disk record so a fresh read returns port: N',
        async () => {
            const handle = await claim(vault)
            handles.push(handle)

            await handle.bindPort(54321)

            const onDisk = await readOwnerRecord(
                ownerRecordFile.pathFor(vault, 'vtd'),
            )
            expect(onDisk?.port).toBe(54321)
            // In-memory handle agrees with disk.
            expect(handle.current().port).toBe(54321)
            // Health projection becomes non-null once the port is bound.
            const health = handle.health()
            expect(health).not.toBeNull()
            expect(health?.port).toBe(54321)
            expect(health?.ownerNonce).toBe(onDisk?.ownerNonce)
            expect(health?.contractVersion).toBe(VTD_CONTRACT_VERSION)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'health() returns null until bindPort resolves',
        async () => {
            const handle = await claim(vault)
            handles.push(handle)

            expect(handle.health()).toBeNull()

            await handle.bindPort(40001)
            expect(handle.health()).not.toBeNull()
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'startHeartbeat advances heartbeatAtMs on disk',
        async () => {
            let nowMs = 1_700_000_000_000
            const handle = await claim(vault, { clock: () => nowMs })
            handles.push(handle)

            const initial = await readOwnerRecord(
                ownerRecordFile.pathFor(vault, 'vtd'),
            )
            expect(initial).not.toBeNull()
            const initialHeartbeat = initial!.heartbeatAtMs

            const stop = handle.startHeartbeat(20)
            try {
                // Advance the synthetic clock so the next heartbeat tick
                // writes a strictly-larger value.
                nowMs += 5_000
                const deadline = Date.now() + 1_000
                let observed = initialHeartbeat
                while (Date.now() < deadline) {
                    const probe = await readOwnerRecord(
                        ownerRecordFile.pathFor(vault, 'vtd'),
                    )
                    if (probe && probe.heartbeatAtMs > initialHeartbeat) {
                        observed = probe.heartbeatAtMs
                        break
                    }
                    await new Promise((r) => setTimeout(r, 25))
                }
                expect(observed).toBeGreaterThan(initialHeartbeat)
            } finally {
                stop()
            }
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'release() deletes the owner record; second release is a no-op',
        async () => {
            const handle = await claim(vault)
            const ownerPath = ownerRecordFile.pathFor(vault, 'vtd')

            // Sanity: present after claim.
            await stat(ownerPath)

            await handle.release()
            await expect(stat(ownerPath)).rejects.toMatchObject({ code: 'ENOENT' })

            // Second release must not throw and must not re-create the file.
            await expect(handle.release()).resolves.toBeUndefined()
            await expect(stat(ownerPath)).rejects.toMatchObject({ code: 'ENOENT' })
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'release drains in-flight writes so a pending heartbeat tick cannot re-create the file',
        async () => {
            const handle = await claim(vault)
            const ownerPath = ownerRecordFile.pathFor(vault, 'vtd')

            // Kick off a few heartbeat ticks at a fast cadence; while they
            // are scheduled, call release(). The drain in release() must
            // wait for any in-flight write to finish before deleting.
            const stop = handle.startHeartbeat(5)
            // Give the interval timer a chance to enqueue at least one tick.
            await new Promise((r) => setTimeout(r, 30))
            stop()
            await handle.release()

            // Settle a generous window — if drain were missing, a queued
            // heartbeat could replay the record back onto disk after the
            // delete fired.
            await new Promise((r) => setTimeout(r, 100))
            await expect(stat(ownerPath)).rejects.toMatchObject({ code: 'ENOENT' })
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'a live preexisting owner causes claim to throw VtDaemonOwnerConflictError and leaves the record untouched',
        async () => {
            const preexisting = await writeRecordRaw(vault, 'vtd', {
                pid: process.pid,
                ownerNonce: 'live-owner-nonce',
            })

            await expect(claim(vault)).rejects.toBeInstanceOf(
                VtDaemonOwnerConflictError,
            )

            const onDisk = await readOwnerRecord(
                ownerRecordFile.pathFor(vault, 'vtd'),
            )
            expect(onDisk?.ownerNonce).toBe(preexisting.ownerNonce)
            expect(onDisk?.pid).toBe(preexisting.pid)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'conflict error carries the existing owner record and the canonical vault',
        async () => {
            await writeRecordRaw(vault, 'vtd', {
                pid: process.pid,
                ownerNonce: 'distinctive-conflict-nonce',
            })

            const err = await claim(vault).catch((e) => e)
            expect(err).toBeInstanceOf(VtDaemonOwnerConflictError)
            const conflict = err as VtDaemonOwnerConflictError
            expect(conflict.code).toBe('VT_DAEMON_OWNER_CONFLICT')
            expect(conflict.canonicalVault).toBe(vault)
            expect(conflict.existingOwner.ownerNonce).toBe(
                'distinctive-conflict-nonce',
            )
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'a dead-pid preexisting owner is reclaimed with a fresh nonce',
        async () => {
            const stalePid = await deadPid()
            const stale = await writeRecordRaw(vault, 'vtd', {
                pid: stalePid,
                ownerNonce: 'stale-dead-pid-nonce',
            })

            const handle = await claim(vault)
            handles.push(handle)

            const onDisk = await readOwnerRecord(
                ownerRecordFile.pathFor(vault, 'vtd'),
            )
            expect(onDisk).not.toBeNull()
            expect(onDisk?.pid).toBe(process.pid)
            expect(onDisk?.ownerNonce).not.toBe(stale.ownerNonce)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'concurrent bindPort + heartbeat both land on disk (write serialisation)',
        async () => {
            let nowMs = 1_700_000_000_000
            const handle = await claim(vault, { clock: () => nowMs })
            handles.push(handle)

            const initial = await readOwnerRecord(
                ownerRecordFile.pathFor(vault, 'vtd'),
            )
            const initialHeartbeat = initial!.heartbeatAtMs

            const stop = handle.startHeartbeat(5)
            try {
                // Immediately ask for a bindPort while heartbeats are
                // already firing. The per-handle promise chain must
                // serialise both so the final disk state carries BOTH
                // the bound port AND an advanced heartbeat.
                nowMs += 1_000
                await handle.bindPort(40123)

                // Allow a few more ticks past bindPort.
                nowMs += 1_000
                await new Promise((r) => setTimeout(r, 60))

                const final = await readOwnerRecord(
                    ownerRecordFile.pathFor(vault, 'vtd'),
                )
                expect(final?.port).toBe(40123)
                expect(final?.heartbeatAtMs).toBeGreaterThan(initialHeartbeat)
            } finally {
                stop()
            }
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'coexists with a graphd owner record for the same vault — neither file disturbs the other',
        async () => {
            const graphd = await writeRecordRaw(vault, 'graphd', {
                ownerNonce: 'graphd-owner-nonce',
                pid: process.pid,
                contractVersion: '0.2.0',
            })

            const handle = await claim(vault)
            handles.push(handle)

            // Both files exist; the graphd file is exactly as we wrote it.
            const graphdAfter = await readOwnerRecord(
                ownerRecordFile.pathFor(vault, 'graphd'),
            )
            expect(graphdAfter?.daemonKind).toBe('graphd')
            expect(graphdAfter?.ownerNonce).toBe(graphd.ownerNonce)
            expect(graphdAfter?.contractVersion).toBe('0.2.0')

            const vtd = await readOwnerRecord(
                ownerRecordFile.pathFor(vault, 'vtd'),
            )
            expect(vtd?.daemonKind).toBe('vtd')
            expect(vtd?.contractVersion).toBe(VTD_CONTRACT_VERSION)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'two concurrent claims for the same vault: exactly one survivor, the other receives a typed conflict',
        async () => {
            const settled = await Promise.allSettled([claim(vault), claim(vault)])
            const winners = settled.filter(
                (r): r is PromiseFulfilledResult<VtDaemonOwnerHandle> =>
                    r.status === 'fulfilled',
            )
            const losers = settled.filter(
                (r): r is PromiseRejectedResult => r.status === 'rejected',
            )

            expect(winners).toHaveLength(1)
            expect(losers).toHaveLength(1)
            handles.push(winners[0].value)

            expect(losers[0].reason).toBeInstanceOf(VtDaemonOwnerConflictError)
            const conflict = losers[0].reason as VtDaemonOwnerConflictError
            expect(conflict.canonicalVault).toBe(vault)
            expect(conflict.existingOwner.pid).toBe(process.pid)
        },
        TEST_TIMEOUT_MS,
    )

    test(
        'bindPort after release rejects with a clear message',
        async () => {
            const handle = await claim(vault)
            await handle.release()

            await expect(handle.bindPort(40000)).rejects.toThrow(
                /already released/,
            )
        },
        TEST_TIMEOUT_MS,
    )
})
