import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
    isDaemonGraphSyncActive,
    setDaemonGraphSyncTier,
    startDaemonGraphSync,
    stopDaemonGraphSync,
} from './daemon-watch-sync'

describe('startDaemonGraphSync — circuit breaker', () => {
    beforeEach(async () => {
        await stopDaemonGraphSync()
        vi.useFakeTimers()
    })

    afterEach(async () => {
        vi.useRealTimers()
        await stopDaemonGraphSync()
    })

    test('stops polling after a bounded number of consecutive failures', async () => {
        // First call (initial sync) succeeds, every subsequent interval fires fail.
        let callCount: number = 0
        const syncFn = async (_project: string): Promise<void> => {
            callCount += 1
            if (callCount === 1) return
            throw new Error('simulated daemon failure')
        }

        await startDaemonGraphSync('project', {
            syncFn,
            pollIntervalMs: 100,
        })
        expect(callCount).toBe(1)
        expect(isDaemonGraphSyncActive()).toBe(true)

        // Advance well past where a circuit breaker should kick in.
        // 25 ticks × 100ms = 2.5s of simulated time.
        for (let i = 0; i < 25; i += 1) {
            await vi.advanceTimersByTimeAsync(100)
        }

        // Bug: today this is ~26 (initial success + 25 failed polls; loop never stops).
        // Fix: after K consecutive failures (≤ 5), the poll must stop. So total
        // call count is initial(1) + K failures and never grows again.
        expect(callCount).toBeLessThanOrEqual(6)

        // Confirm the loop has actually stopped: more time should not produce
        // more calls.
        const stableCount: number = callCount
        for (let i = 0; i < 20; i += 1) {
            await vi.advanceTimersByTimeAsync(100)
        }
        expect(callCount).toBe(stableCount)
    }, 10_000)
})

describe('setDaemonGraphSyncTier — three-tier polling', () => {
    beforeEach(async () => {
        await stopDaemonGraphSync()
        vi.useFakeTimers()
    })

    afterEach(async () => {
        vi.useRealTimers()
        await stopDaemonGraphSync()
    })

    test('no-ops when sync is not active', () => {
        // Should not throw when called before startDaemonGraphSync
        setDaemonGraphSyncTier('idle')
        expect(isDaemonGraphSyncActive()).toBe(false)
    })

    test('active tier polls at 750ms', async () => {
        let callCount = 0
        const syncFn = async (): Promise<void> => { callCount++ }

        await startDaemonGraphSync('project', { syncFn, pollIntervalMs: 750 })
        expect(callCount).toBe(1) // initial sync

        setDaemonGraphSyncTier('active')
        // active tier triggers an immediate sync
        await vi.advanceTimersByTimeAsync(0)
        expect(callCount).toBe(2)

        // Then polls at 750ms
        await vi.advanceTimersByTimeAsync(750)
        expect(callCount).toBe(3)

        await vi.advanceTimersByTimeAsync(750)
        expect(callCount).toBe(4)
    })

    test('background tier polls at 5000ms', async () => {
        let callCount = 0
        const syncFn = async (): Promise<void> => { callCount++ }

        await startDaemonGraphSync('project', { syncFn, pollIntervalMs: 750 })
        callCount = 0

        setDaemonGraphSyncTier('background')

        // Should NOT poll at 750ms
        await vi.advanceTimersByTimeAsync(750)
        expect(callCount).toBe(0)

        // Should poll at 5000ms
        await vi.advanceTimersByTimeAsync(5000 - 750)
        expect(callCount).toBe(1)

        await vi.advanceTimersByTimeAsync(5000)
        expect(callCount).toBe(2)
    })

    test('idle tier polls at 60000ms', async () => {
        let callCount = 0
        const syncFn = async (): Promise<void> => { callCount++ }

        await startDaemonGraphSync('project', { syncFn, pollIntervalMs: 750 })
        callCount = 0

        setDaemonGraphSyncTier('idle')

        // Should NOT poll at 5s
        await vi.advanceTimersByTimeAsync(5000)
        expect(callCount).toBe(0)

        // Should poll at 60s
        await vi.advanceTimersByTimeAsync(60_000 - 5000)
        expect(callCount).toBe(1)
    })

    test('switching from idle to active triggers immediate sync and resumes fast polling', async () => {
        let callCount = 0
        const syncFn = async (): Promise<void> => { callCount++ }

        await startDaemonGraphSync('project', { syncFn, pollIntervalMs: 750 })
        callCount = 0

        setDaemonGraphSyncTier('idle')
        await vi.advanceTimersByTimeAsync(30_000)
        expect(callCount).toBe(0)

        // Switch to active — triggers immediate sync
        setDaemonGraphSyncTier('active')
        await vi.advanceTimersByTimeAsync(0)
        expect(callCount).toBe(1)

        // Back to 750ms polling
        await vi.advanceTimersByTimeAsync(750)
        expect(callCount).toBe(2)
    })
})
