import { afterEach, describe, expect, test, vi } from 'vitest'
import {
    awaitProjectOpenReady,
    beginProjectOpen,
    completeProjectOpen,
    resetProjectOpenGate,
} from '../projectOpenGate.ts'

afterEach((): void => {
    resetProjectOpenGate()
})

describe('projectOpenGate', (): void => {
    test('awaitProjectOpenReady returns immediately when no open is in progress', async (): Promise<void> => {
        const start = Date.now()
        await awaitProjectOpenReady(1000)
        const elapsed = Date.now() - start

        expect(elapsed).toBeLessThan(50)
    })

    test('awaitProjectOpenReady waits until completeProjectOpen resolves the gate', async (): Promise<void> => {
        beginProjectOpen()

        const order: string[] = []
        const waiter = awaitProjectOpenReady(5000).then((): void => {
            order.push('waiter-resumed')
        })

        // Yield to the microtask queue twice to give the waiter a chance to
        // make progress if (incorrectly) it weren't blocked.
        await Promise.resolve()
        await Promise.resolve()
        order.push('open-completing')
        completeProjectOpen()

        await waiter
        expect(order).toEqual(['open-completing', 'waiter-resumed'])
    })

    test('awaitProjectOpenReady falls through after timeout when open never completes', async (): Promise<void> => {
        vi.useFakeTimers()
        try {
            beginProjectOpen()

            const waiter = awaitProjectOpenReady(100)
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

    test('completeProjectOpen is a no-op when no open is pending', async (): Promise<void> => {
        // Should not throw; subsequent await still returns immediately.
        completeProjectOpen()
        await awaitProjectOpenReady(1000)
    })

    test('resetProjectOpenGate releases waiters', async (): Promise<void> => {
        beginProjectOpen()
        const waiter = awaitProjectOpenReady(5000)
        resetProjectOpenGate()
        await waiter
    })

    test('a second beginProjectOpen releases the previous waiters', async (): Promise<void> => {
        beginProjectOpen()
        const firstWaiter = awaitProjectOpenReady(5000)

        // Simulate a second open being issued before the first completed.
        // The defensive branch in beginProjectOpen must release prior waiters
        // rather than orphan them.
        beginProjectOpen()
        await firstWaiter

        const secondWaiter = awaitProjectOpenReady(5000).then((): string => 'done')
        completeProjectOpen()
        await expect(secondWaiter).resolves.toBe('done')
    })
})
