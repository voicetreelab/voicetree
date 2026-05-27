import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    awaitVaultOpenReady,
    beginVaultOpen,
    completeVaultOpen,
    resetVaultOpenGate,
} from '../vaultOpenGate.ts'

afterEach((): void => {
    resetVaultOpenGate()
})

describe('vaultOpenGate', (): void => {
    test('awaitVaultOpenReady returns immediately when no open is in progress', async (): Promise<void> => {
        const start = Date.now()
        await awaitVaultOpenReady(1000)
        const elapsed = Date.now() - start

        expect(elapsed).toBeLessThan(50)
    })

    test('awaitVaultOpenReady waits until completeVaultOpen resolves the gate', async (): Promise<void> => {
        beginVaultOpen()

        const order: string[] = []
        const waiter = awaitVaultOpenReady(5000).then((): void => {
            order.push('waiter-resumed')
        })

        // Yield to the microtask queue twice to give the waiter a chance to
        // make progress if (incorrectly) it weren't blocked.
        await Promise.resolve()
        await Promise.resolve()
        order.push('open-completing')
        completeVaultOpen()

        await waiter
        expect(order).toEqual(['open-completing', 'waiter-resumed'])
    })

    test('awaitVaultOpenReady falls through after timeout when open never completes', async (): Promise<void> => {
        vi.useFakeTimers()
        try {
            beginVaultOpen()

            const waiter = awaitVaultOpenReady(100)
            let resolved = false
            void waiter.then((): void => {
                resolved = true
            })

            // Before timeout: still waiting.
            await Promise.resolve()
            expect(resolved).toBe(false)

            await vi.advanceTimersByTimeAsync(100)
            await waiter
            expect(resolved).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    test('completeVaultOpen is a no-op when no open is pending', async (): Promise<void> => {
        // Should not throw; subsequent await still returns immediately.
        completeVaultOpen()
        await awaitVaultOpenReady(1000)
    })

    test('resetVaultOpenGate releases waiters', async (): Promise<void> => {
        beginVaultOpen()
        const waiter = awaitVaultOpenReady(5000)
        resetVaultOpenGate()
        await waiter
    })

    test('a second beginVaultOpen releases the previous waiters', async (): Promise<void> => {
        beginVaultOpen()
        const firstWaiter = awaitVaultOpenReady(5000)

        // Simulate a second open being issued before the first completed.
        // The defensive branch in beginVaultOpen must release prior waiters
        // rather than orphan them.
        beginVaultOpen()
        await firstWaiter

        const secondWaiter = awaitVaultOpenReady(5000).then((): string => 'done')
        completeVaultOpen()
        await expect(secondWaiter).resolves.toBe('done')
    })
})
