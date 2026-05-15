import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
    isDaemonGraphSyncActive,
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
        const syncFn = async (_vault: string): Promise<void> => {
            callCount += 1
            if (callCount === 1) return
            throw new Error('simulated daemon failure')
        }

        await startDaemonGraphSync('vault', {
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
