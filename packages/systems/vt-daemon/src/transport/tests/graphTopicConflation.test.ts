// Black-box test for the `graph` topic's latest-wins conflation (RE-PLAN B).
//
// Full ProjectedGraph snapshots are large + frequent. A slow subscriber must
// receive the LATEST snapshot and must NOT be force-closed (overflow → WS 1011)
// for falling behind, because each snapshot is an idempotent full replace.
// We drive the hub with a subscriber whose `send` holds the `onSent` flush
// callback (simulating a socket that hasn't drained) and observe what reaches
// the wire.

import {describe, expect, it} from 'vitest'

import {
    createEventSubscriptionHub,
    type Subscriber,
} from '../sse/eventSubscriptionHub.ts'

interface CapturedFrame {
    readonly topic: string
    readonly data: {readonly n: number}
}

function makeSlowSubscriber(): {
    readonly subscriber: Subscriber
    readonly received: CapturedFrame[]
    flush: () => boolean
    overflowCount: () => number
} {
    const received: CapturedFrame[] = []
    let pendingOnSent: (() => void) | null = null
    let overflows = 0
    return {
        subscriber: {
            send: (frame: string, onSent?: () => void): void => {
                received.push(JSON.parse(frame) as CapturedFrame)
                pendingOnSent = onSent ?? null // hold the flush — socket is "busy"
            },
            overflow: (): void => {
                overflows += 1
            },
        },
        received,
        // Release the in-flight send; returns whether a callback was waiting.
        flush: (): boolean => {
            const cb = pendingOnSent
            pendingOnSent = null
            if (cb) cb()
            return cb !== null
        },
        overflowCount: (): number => overflows,
    }
}

describe('graph topic latest-wins conflation', () => {
    it('sends the first snapshot, then conflates intermediates to the latest', () => {
        const hub = createEventSubscriptionHub()
        const s = makeSlowSubscriber()
        const handle = hub.addSubscriber(s.subscriber)
        handle.subscribe([{topic: 'graph'}])

        // First snapshot goes out immediately (nothing in flight).
        hub.publish('graph', 'projectedGraph', {n: 1})
        // 2..5 arrive while #1 is still draining → only the latest is retained.
        for (let n = 2; n <= 5; n++) hub.publish('graph', 'projectedGraph', {n})

        expect(s.received.map(f => f.data.n)).toEqual([1])
        expect(s.overflowCount()).toBe(0)

        // Flush #1 → the pump releases the LATEST pending snapshot (#5), skipping 2..4.
        expect(s.flush()).toBe(true)
        expect(s.received.map(f => f.data.n)).toEqual([1, 5])

        // Flush #5 → nothing pending; the stream is idle, not closed.
        expect(s.flush()).toBe(true)
        expect(s.received.map(f => f.data.n)).toEqual([1, 5])
        expect(s.overflowCount()).toBe(0)
    })

    it('never force-closes the subscriber even for a snapshot far over the 1 MiB byte cap', () => {
        const hub = createEventSubscriptionHub()
        const s = makeSlowSubscriber()
        const handle = hub.addSubscriber(s.subscriber)
        handle.subscribe([{topic: 'graph'}])

        const huge = 'x'.repeat(2 * 1024 * 1024) // 2 MiB payload, > PER_SUBSCRIBER_BYTE_LIMIT
        hub.publish('graph', 'projectedGraph', {n: 1, blob: huge})

        expect(s.received.length).toBe(1)
        expect(s.overflowCount()).toBe(0)
    })

    it('delivers every snapshot when the subscriber keeps up (drains between publishes)', () => {
        const hub = createEventSubscriptionHub()
        const s = makeSlowSubscriber()
        const handle = hub.addSubscriber(s.subscriber)
        handle.subscribe([{topic: 'graph'}])

        for (let n = 1; n <= 4; n++) {
            hub.publish('graph', 'projectedGraph', {n})
            s.flush() // drain before the next publish → no conflation
        }
        expect(s.received.map(f => f.data.n)).toEqual([1, 2, 3, 4])
        expect(s.overflowCount()).toBe(0)
    })

    it('does NOT conflate an exact-replay topic (agent-events keeps every event)', () => {
        const hub = createEventSubscriptionHub()
        const received: Array<{seq: number}> = []
        const handle = hub.addSubscriber({
            send: (frame: string): void => {
                received.push(JSON.parse(frame) as {seq: number})
            },
            overflow: (): void => {},
        })
        handle.subscribe([{topic: 'terminal-registry'}])

        for (let i = 0; i < 4; i++) {
            hub.publish('terminal-registry', 'tick', {terminalId: 't', source: 'claude', at: i})
        }
        // No onSent honoured, yet all four arrive: agent-events uses the
        // synchronous (non-conflating) path.
        expect(received.map(f => f.seq)).toEqual([1, 2, 3, 4])
    })
})
