import { describe, expect, it } from 'vitest'

import {
    createLayoutStore,
    type FlushScheduler,
    type LayoutDelta,
} from '../../src/state/layoutStore'

/**
 * Test scheduler captures the flush callback so tests can run it manually.
 * Without this, `requestAnimationFrame` either fires async (timing-flake) or
 * doesn't exist in node (silent no-op). Manual flush = deterministic.
 */
function manualScheduler(): { readonly schedule: FlushScheduler; pending: Array<() => void> } {
    const pending: Array<() => void> = []
    return {
        pending,
        schedule: (cb): void => { pending.push(cb) },
    }
}

function drain(pending: Array<() => void>): void {
    const cbs = pending.splice(0, pending.length)
    for (const cb of cbs) cb()
}

describe('layoutStore (BF-167)', () => {
    it('returns initial layout', () => {
        const store = createLayoutStore({
            initialLayout: { positions: new Map([['/a.md', { x: 1, y: 2 }]]), zoom: 1.5 },
        })

        expect(store.getLayout().zoom).toBe(1.5)
        expect(store.getLayout().positions.get('/a.md')).toEqual({ x: 1, y: 2 })
    })

    it('flush() emits one delta to subscribers and updates state', () => {
        const sched = manualScheduler()
        const store = createLayoutStore({ scheduler: sched.schedule })
        const received: LayoutDelta[] = []
        store.subscribeLayout((d) => received.push(d))

        store.dispatchSetZoom(2)
        expect(received).toHaveLength(0)
        expect(store.getLayout().zoom).toBeUndefined() // not yet flushed

        drain(sched.pending)

        expect(received).toHaveLength(1)
        expect(received[0].zoom).toBe(2)
        expect(store.getLayout().zoom).toBe(2)
    })

    it('coalesces multiple zoom dispatches in one frame (last-wins)', () => {
        const sched = manualScheduler()
        const store = createLayoutStore({ scheduler: sched.schedule })
        const received: LayoutDelta[] = []
        store.subscribeLayout((d) => received.push(d))

        // Simulate a 60fps zoom-wheel burst: 60 dispatches in one frame.
        for (let i = 1; i <= 60; i += 1) {
            store.dispatchSetZoom(i / 60)
        }

        drain(sched.pending)

        expect(received).toHaveLength(1)
        expect(received[0].zoom).toBe(1) // last-wins
        expect(store.getLayout().zoom).toBe(1)
    })

    it('coalesces pan + zoom + fit in one frame into one delta', () => {
        const sched = manualScheduler()
        const store = createLayoutStore({ scheduler: sched.schedule })
        const received: LayoutDelta[] = []
        store.subscribeLayout((d) => received.push(d))

        store.dispatchSetZoom(1.2)
        store.dispatchSetPan({ x: 5, y: 5 })
        store.dispatchSetZoom(1.4)
        store.dispatchSetPan({ x: 10, y: 20 })
        store.dispatchRequestFit(40)

        drain(sched.pending)

        expect(received).toHaveLength(1)
        expect(received[0].zoom).toBe(1.4)        // last-wins
        expect(received[0].pan).toEqual({ x: 10, y: 20 })  // last-wins
        expect(received[0].fit).toEqual({ paddingPx: 40 })
    })

    it('merges positions by nodeId across multiple dispatches in one frame', () => {
        const sched = manualScheduler()
        const store = createLayoutStore({ scheduler: sched.schedule })
        const received: LayoutDelta[] = []
        store.subscribeLayout((d) => received.push(d))

        store.dispatchSetPositions(new Map([
            ['/a.md', { x: 1, y: 1 }],
            ['/b.md', { x: 2, y: 2 }],
        ]))
        store.dispatchSetPositions(new Map([
            ['/b.md', { x: 20, y: 20 }],   // overwrites earlier /b.md in same frame
            ['/c.md', { x: 3, y: 3 }],
        ]))

        drain(sched.pending)

        expect(received).toHaveLength(1)
        const positions = received[0].positions
        expect(positions?.get('/a.md')).toEqual({ x: 1, y: 1 })
        expect(positions?.get('/b.md')).toEqual({ x: 20, y: 20 })
        expect(positions?.get('/c.md')).toEqual({ x: 3, y: 3 })
        expect(positions?.size).toBe(3)

        expect(store.getLayout().positions.get('/b.md')).toEqual({ x: 20, y: 20 })
    })

    it('does not emit a delta when batched values match current state', () => {
        const sched = manualScheduler()
        const store = createLayoutStore({
            initialLayout: { positions: new Map(), zoom: 2, pan: { x: 0, y: 0 } },
            scheduler: sched.schedule,
        })
        const received: LayoutDelta[] = []
        store.subscribeLayout((d) => received.push(d))

        store.dispatchSetZoom(2)
        store.dispatchSetPan({ x: 0, y: 0 })

        drain(sched.pending)

        expect(received).toHaveLength(0)
    })

    it('two consecutive frames produce two deltas', () => {
        const sched = manualScheduler()
        const store = createLayoutStore({ scheduler: sched.schedule })
        const received: LayoutDelta[] = []
        store.subscribeLayout((d) => received.push(d))

        store.dispatchSetZoom(1.5)
        drain(sched.pending)
        store.dispatchSetZoom(2)
        drain(sched.pending)

        expect(received).toHaveLength(2)
        expect(received[0].zoom).toBe(1.5)
        expect(received[1].zoom).toBe(2)
    })

    it('subscribeLayout returns a working unsubscribe', () => {
        const sched = manualScheduler()
        const store = createLayoutStore({ scheduler: sched.schedule })
        const received: LayoutDelta[] = []
        const unsub = store.subscribeLayout((d) => received.push(d))

        store.dispatchSetZoom(1.5)
        drain(sched.pending)
        expect(received).toHaveLength(1)

        unsub()
        store.dispatchSetZoom(2)
        drain(sched.pending)
        expect(received).toHaveLength(1)
    })

    it('flush() returns true when delta emitted, false when nothing pending', () => {
        const sched = manualScheduler()
        const store = createLayoutStore({ scheduler: sched.schedule })

        expect(store.flush()).toBe(false)

        store.dispatchSetZoom(3)
        expect(store.flush()).toBe(true)
        expect(store.flush()).toBe(false)
    })

    it('dispose() cancels pending flush and clears subscribers', () => {
        const sched = manualScheduler()
        const store = createLayoutStore({ scheduler: sched.schedule })
        const received: LayoutDelta[] = []
        store.subscribeLayout((d) => received.push(d))

        store.dispatchSetZoom(1.5)
        store.dispose()
        drain(sched.pending)

        expect(received).toHaveLength(0)
    })

    it('RequestFit always emits even when paddingPx unchanged (gesture)', () => {
        const sched = manualScheduler()
        const store = createLayoutStore({ scheduler: sched.schedule })
        const received: LayoutDelta[] = []
        store.subscribeLayout((d) => received.push(d))

        store.dispatchRequestFit(50)
        drain(sched.pending)
        store.dispatchRequestFit(50)
        drain(sched.pending)

        expect(received).toHaveLength(2)
        expect(received[0].fit).toEqual({ paddingPx: 50 })
        expect(received[1].fit).toEqual({ paddingPx: 50 })
    })

    it('queueMicrotask scheduler (default-ish) auto-flushes async', async () => {
        const store = createLayoutStore({
            scheduler: (cb): void => { queueMicrotask(cb) },
        })
        const received: LayoutDelta[] = []
        store.subscribeLayout((d) => received.push(d))

        store.dispatchSetZoom(2.5)
        await new Promise<void>((resolve) => { queueMicrotask(resolve) })

        expect(received).toHaveLength(1)
        expect(received[0].zoom).toBe(2.5)
    })
})
