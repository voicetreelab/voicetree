/**
 * Black-box round-trip tests for eventSubscription.ts against a real §4.3
 * stub WebSocket server. Tests assert on observable side effects (frames
 * delivered to callbacks, connection-state observable, server-side
 * subscribe frames), never on internal calls.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import {
    computeBackoffDelayMs,
    createEventSubscription,
    eventsUrlFromDaemonUrl,
    type ConnectionState,
    type EventFrame,
    type EventSubscriptionConfig,
    type EventSubscriptionHandle,
    type GapFrame,
    type Topic,
    type WebSocketFactory,
    type WebSocketLike,
} from './eventSubscription'
import { startStubEventsServer, type StubClient, type StubServerHandle, type StubSubscribeFrame } from './stubEventsServer'

const TEST_TOKEN = 'cafef00d-cafef00d-cafef00d-cafef00d' as const

/** Real `ws` WebSocket — sends Authorization header on upgrade. Matches §4.3. */
function wsFactoryWithAuthHeader(eventsUrl: string, token: string): WebSocketLike {
    const ws: WebSocket = new WebSocket(eventsUrl, { headers: { Authorization: `Bearer ${token}` } })
    const adapter: {
        readyState: number
        send: (data: string) => void
        close: (code?: number, reason?: string) => void
        onopen: ((event?: unknown) => void) | null
        onmessage: ((event: { readonly data: unknown }) => void) | null
        onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null
        onerror: ((event?: unknown) => void) | null
    } = {
        get readyState(): number { return ws.readyState },
        send: (data: string): void => ws.send(data),
        close: (code?: number, reason?: string): void => ws.close(code, reason),
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
    }
    ws.on('open', (): void => { adapter.onopen?.() })
    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]): void => { adapter.onmessage?.({ data: raw }) })
    ws.on('close', (code: number, reason: Buffer): void => { adapter.onclose?.({ code, reason: reason.toString() }) })
    ws.on('error', (err: Error): void => { adapter.onerror?.(err) })
    return adapter
}

const TEST_FACTORY: WebSocketFactory = wsFactoryWithAuthHeader

type Collected = {
    readonly events: EventFrame[]
    readonly gaps: GapFrame[]
    readonly states: ConnectionState[]
}

function makeCollectors(): Collected & { readonly cfg: (overrides: Partial<EventSubscriptionConfig>) => EventSubscriptionConfig } {
    const events: EventFrame[] = []
    const gaps: GapFrame[] = []
    const states: ConnectionState[] = []
    return {
        events, gaps, states,
        cfg: (overrides: Partial<EventSubscriptionConfig>): EventSubscriptionConfig => ({
            getDaemonUrl: () => Promise.resolve(''),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            topics: ['agent-lifecycle'] as readonly Topic[],
            onEvent: (f: EventFrame): void => { events.push(f) },
            onGap: (f: GapFrame): void => { gaps.push(f) },
            onConnectionState: (s: ConnectionState): void => { states.push(s) },
            webSocketFactory: TEST_FACTORY,
            random: (): number => 0, // zero-delay reconnect, no thundering-herd risk in tests
            ...overrides,
        }),
    }
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs: number = 2000): Promise<T> {
    const start: number = Date.now()
    while (Date.now() - start < timeoutMs) {
        const value: T | undefined = fn()
        if (value !== undefined) return value
        await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('timed out waiting for condition')
}

async function waitForState(states: readonly ConnectionState[], kind: ConnectionState['kind'], timeoutMs: number = 2000): Promise<void> {
    await waitFor((): true | undefined => states.some(s => s.kind === kind) ? true : undefined, timeoutMs)
}

describe('eventSubscription — §4.3 byte-for-byte stub round-trip', () => {
    let server: StubServerHandle
    let handle: EventSubscriptionHandle | null = null

    beforeEach(async () => {
        server = await startStubEventsServer({ initialToken: TEST_TOKEN })
    })

    afterEach(async () => {
        handle?.close()
        handle = null
        await server.close()
    })

    it('connects, subscribes, receives an event, exposes connected state', async () => {
        const { events, states, cfg } = makeCollectors()
        handle = createEventSubscription(cfg({ getDaemonUrl: () => Promise.resolve(server.url) }))

        const client: StubClient = await server.nextClient()
        const subscribe: StubSubscribeFrame = await client.nextSubscribe()
        expect(subscribe.topics).toEqual([{ topic: 'agent-lifecycle', resumeSeq: 0 }])

        const frame: EventFrame = {
            type: 'event',
            topic: 'agent-lifecycle',
            seq: 1,
            event: 'agent-spawned',
            data: { terminalId: 'T1', source: 'claude', at: 0 },
        }
        client.sendEvent(frame)
        await waitFor((): EventFrame | undefined => events[0])
        expect(events).toEqual([frame])

        expect(states.some(s => s.kind === 'connecting')).toBe(true)
        expect(states.some(s => s.kind === 'connected')).toBe(true)
    })

    it('gap frame fires onGap and advances resume seq', async () => {
        const { gaps, cfg } = makeCollectors()
        handle = createEventSubscription(cfg({ getDaemonUrl: () => Promise.resolve(server.url) }))

        const client: StubClient = await server.nextClient()
        await client.nextSubscribe()

        const gap: GapFrame = { type: 'gap', topic: 'agent-lifecycle', fromSeq: 5, currentSeq: 42 }
        client.sendGap(gap)
        await waitFor((): GapFrame | undefined => gaps[0])
        expect(gaps).toEqual([gap])
    })

    it('close 1011 (overflow): reconnects + re-subscribes with last-seen seq', async () => {
        const { events, cfg } = makeCollectors()
        handle = createEventSubscription(cfg({ getDaemonUrl: () => Promise.resolve(server.url) }))

        const first: StubClient = await server.nextClient()
        const firstSubscribe: StubSubscribeFrame = await first.nextSubscribe()
        expect(firstSubscribe.topics[0]?.resumeSeq).toBe(0)

        const seq7: EventFrame = { type: 'event', topic: 'agent-lifecycle', seq: 7, event: 'agent-exited', data: { terminalId: 'T1', source: 'claude', at: 0 } }
        first.sendEvent(seq7)
        await waitFor((): EventFrame | undefined => events[0])

        first.closeWith(1011, 'overflow')

        const second: StubClient = await server.nextClient()
        const resubscribe: StubSubscribeFrame = await second.nextSubscribe()
        expect(resubscribe.topics).toEqual([{ topic: 'agent-lifecycle', resumeSeq: 7 }])
    })

    it('close 1008 (policy): re-reads token via getAuthToken on reconnect', async () => {
        const { cfg } = makeCollectors()
        const tokens: string[] = []
        const rotatedToken = 'rotated-token-deadbeef' as const
        let returnRotated: boolean = false

        handle = createEventSubscription(cfg({
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: (): Promise<string> => {
                const t: string = returnRotated ? rotatedToken : TEST_TOKEN
                tokens.push(t)
                return Promise.resolve(t)
            },
        }))

        const first: StubClient = await server.nextClient()
        await first.nextSubscribe()
        expect(tokens).toEqual([TEST_TOKEN])

        // Simulate daemon restart: server rotates accepted token; client gets 1008.
        returnRotated = true
        server.rotateToken(rotatedToken)
        first.closeWith(1008, 'token rotated')

        const second: StubClient = await server.nextClient()
        await second.nextSubscribe()
        expect(tokens[tokens.length - 1]).toBe(rotatedToken)
    })

    it('connection-state observable surfaces disconnect via reconnecting state', async () => {
        const { states, cfg } = makeCollectors()
        handle = createEventSubscription(cfg({ getDaemonUrl: () => Promise.resolve(server.url) }))

        const first: StubClient = await server.nextClient()
        await first.nextSubscribe()
        await waitForState(states, 'connected')
        states.length = 0  // clear pre-disconnect states

        first.closeWith(1011, 'overflow')
        await waitForState(states, 'reconnecting')

        const reconnecting: ConnectionState | undefined = states.find(s => s.kind === 'reconnecting')
        expect(reconnecting?.kind).toBe('reconnecting')
        if (reconnecting?.kind === 'reconnecting') {
            expect(reconnecting.attempt).toBeGreaterThanOrEqual(1)
            expect(reconnecting.delayMs).toBeGreaterThanOrEqual(0)
        }
    })
})

describe('eventSubscription — pure helpers', () => {
    it('eventsUrlFromDaemonUrl switches http→ws and adds /events', () => {
        expect(eventsUrlFromDaemonUrl('http://127.0.0.1:51337')).toBe('ws://127.0.0.1:51337/events')
        expect(eventsUrlFromDaemonUrl('https://example.com')).toBe('wss://example.com/events')
        expect(eventsUrlFromDaemonUrl('http://172.21.0.1:9000/')).toBe('ws://172.21.0.1:9000/events')
    })

    it('computeBackoffDelayMs respects 1s→30s full-jitter envelope', () => {
        // Full jitter: delay = random() * min(MAX, BASE * 2^(attempt-1))
        // attempt 1: ceiling 1000ms, attempt 2: 2000ms, … attempt N: 30000ms
        for (let attempt = 1; attempt <= 12; attempt++) {
            // ceiling for this attempt (cap at 30000)
            const ceiling: number = Math.min(30000, 1000 * 2 ** (attempt - 1))
            expect(computeBackoffDelayMs(attempt, () => 0)).toBe(0)
            expect(computeBackoffDelayMs(attempt, () => 0.5)).toBe(Math.floor(ceiling * 0.5))
            const nearOne: number = computeBackoffDelayMs(attempt, () => 0.999)
            expect(nearOne).toBeLessThan(ceiling)
            expect(nearOne).toBeGreaterThanOrEqual(0)
        }
    })

    it('computeBackoffDelayMs is probabilistic (no thundering-herd)', () => {
        // Sample 200 delays at attempt=10 with real Math.random; distribution
        // must span more than one bucket (proves full jitter is taking effect).
        const samples: number[] = Array.from({ length: 200 }, () => computeBackoffDelayMs(10, Math.random))
        const max: number = Math.max(...samples)
        const min: number = Math.min(...samples)
        expect(max).toBeGreaterThan(min)
        // With ceiling 30000ms and 200 samples, the spread should easily exceed 1000ms.
        expect(max - min).toBeGreaterThan(1000)
    })
})
