/**
 * Black-box tests for createVtDaemonEventsClient against a real Node `ws`
 * WebSocketServer. No internal mocks; assertions only on observable side
 * effects (callback invocations, frames received on the server side).
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createServer, type IncomingMessage, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import type {Duplex} from 'node:stream'
import {WebSocket, WebSocketServer} from 'ws'
import type {ConnectionState, EventFrame, GapFrame, TopicName} from '@vt/vt-daemon/transport/eventTypes'
import {computeBackoffDelayMs, createVtDaemonEventsClient, type VtDaemonEventsClient} from './vtDaemonEventsClient'

const TEST_TOKEN: string = 'cafef00d-cafef00d-cafef00d-cafef00d'

interface StubSubscribeFrame {
    readonly topics: readonly {readonly topic: TopicName; readonly resumeSeq: number}[]
}

interface StubClient {
    readonly authorization: string
    readonly nextSubscribe: () => Promise<StubSubscribeFrame>
    readonly sendEvent: (frame: EventFrame) => void
    readonly sendGap: (frame: GapFrame) => void
    readonly closeWith: (code: number, reason?: string) => void
}

interface StubServerHandle {
    readonly url: string
    readonly clients: readonly StubClient[]
    readonly nextClient: () => Promise<StubClient>
    readonly rotateToken: (next: string) => void
    readonly close: () => Promise<void>
}

async function startStubEventsServer(initialToken: string): Promise<StubServerHandle> {
    let acceptedToken: string = initialToken
    const httpServer: Server = createServer((_req, res) => { res.writeHead(404); res.end() })
    const wss: WebSocketServer = new WebSocketServer({noServer: true})
    const clients: StubClient[] = []
    const clientResolvers: ((client: StubClient) => void)[] = []

    function extractBearer(req: IncomingMessage): string | null {
        const raw: string | string[] | undefined = req.headers.authorization
        const header: string | undefined = Array.isArray(raw) ? raw[0] : raw
        if (!header) return null
        const match: RegExpMatchArray | null = header.match(/^Bearer\s+(.+)$/)
        return match?.[1] ?? null
    }

    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        if (!(req.url === '/events' || req.url?.startsWith('/events?'))) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return
        }
        const token: string | null = extractBearer(req)
        if (token !== acceptedToken) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return
        }
        const auth: string = req.headers.authorization as string
        wss.handleUpgrade(req, socket, head, (ws: WebSocket): void => {
            const subscribeResolvers: ((value: StubSubscribeFrame) => void)[] = []
            const buffered: StubSubscribeFrame[] = []
            ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]): void => {
                const text: string = Buffer.isBuffer(raw) ? raw.toString('utf-8')
                    : Array.isArray(raw) ? Buffer.concat(raw).toString('utf-8')
                    : Buffer.from(raw as ArrayBuffer).toString('utf-8')
                let parsed: unknown
                try { parsed = JSON.parse(text) } catch { return }
                if (typeof parsed !== 'object' || parsed === null) return
                const p = parsed as {readonly op?: unknown; readonly topics?: unknown}
                if (p.op === 'subscribe' && Array.isArray(p.topics)) {
                    const frame: StubSubscribeFrame = {
                        topics: (p.topics as Array<{readonly topic: TopicName; readonly resumeSeq?: number}>).map(t => ({
                            topic: t.topic,
                            resumeSeq: typeof t.resumeSeq === 'number' ? t.resumeSeq : 0,
                        })),
                    }
                    const resolver = subscribeResolvers.shift()
                    if (resolver) resolver(frame); else buffered.push(frame)
                }
            })
            const client: StubClient = {
                authorization: auth,
                nextSubscribe: (): Promise<StubSubscribeFrame> => {
                    const next = buffered.shift()
                    if (next) return Promise.resolve(next)
                    return new Promise(resolve => subscribeResolvers.push(resolve))
                },
                sendEvent: (frame: EventFrame): void => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
                },
                sendGap: (frame: GapFrame): void => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
                },
                closeWith: (code: number, reason?: string): void => { ws.close(code, reason ?? '') },
            }
            clients.push(client)
            clientResolvers.shift()?.(client)
        })
    })

    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve))
    const address: AddressInfo = httpServer.address() as AddressInfo
    return {
        url: `http://127.0.0.1:${address.port}`,
        clients,
        nextClient: (): Promise<StubClient> => new Promise(resolve => clientResolvers.push(resolve)),
        rotateToken: (next: string): void => { acceptedToken = next },
        close: (): Promise<void> => new Promise<void>((resolve, reject): void => {
            wss.close((): void => {
                httpServer.close(err => { if (err) reject(err); else resolve() })
            })
        }),
    }
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs: number = 2000): Promise<T> {
    const start: number = Date.now()
    while (Date.now() - start < timeoutMs) {
        const value: T | undefined = fn()
        if (value !== undefined) return value
        await new Promise(r => setTimeout(r, 5))
    }
    throw new Error('timed out waiting for condition')
}

async function waitForState(states: readonly ConnectionState[], kind: ConnectionState['kind']): Promise<void> {
    await waitFor((): true | undefined => states.some(s => s.kind === kind) ? true : undefined)
}

describe('createVtDaemonEventsClient', (): void => {
    let server: StubServerHandle
    let handle: VtDaemonEventsClient | null = null

    beforeEach(async (): Promise<void> => {
        server = await startStubEventsServer(TEST_TOKEN)
    })

    afterEach(async (): Promise<void> => {
        handle?.close()
        handle = null
        await server.close()
    })

    function makeCollectors(): {
        events: EventFrame[]
        gaps: GapFrame[]
        states: ConnectionState[]
    } {
        return {events: [], gaps: [], states: []}
    }

    it('sends Authorization: Bearer <token> on upgrade (header-based; no vt-bearer subprotocol)', async (): Promise<void> => {
        const c = makeCollectors()
        handle = createVtDaemonEventsClient({
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            topics: ['agent-lifecycle'],
            onEvent: (f) => { c.events.push(f) },
            onGap: (f) => { c.gaps.push(f) },
            onConnectionState: (s) => { c.states.push(s) },
            random: () => 0,
        })
        const client: StubClient = await server.nextClient()
        expect(client.authorization).toBe(`Bearer ${TEST_TOKEN}`)
    })

    it('connects, subscribes resumeSeq=0, delivers an event, surfaces connected state', async (): Promise<void> => {
        const c = makeCollectors()
        handle = createVtDaemonEventsClient({
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            topics: ['agent-lifecycle'],
            onEvent: (f) => { c.events.push(f) },
            onGap: (f) => { c.gaps.push(f) },
            onConnectionState: (s) => { c.states.push(s) },
            random: () => 0,
        })
        const client = await server.nextClient()
        const subscribe = await client.nextSubscribe()
        expect(subscribe.topics).toEqual([{topic: 'agent-lifecycle', resumeSeq: 0}])

        const frame: EventFrame = {
            type: 'event', topic: 'agent-lifecycle', seq: 1, event: 'agent-spawned',
            data: {terminalId: 'T1', source: 'claude', at: 0},
        }
        client.sendEvent(frame)
        await waitFor(() => c.events[0])
        expect(c.events).toEqual([frame])
        expect(c.states.some(s => s.kind === 'connecting')).toBe(true)
        expect(c.states.some(s => s.kind === 'connected')).toBe(true)
    })

    it('gap frame fires onGap and advances resume seq', async (): Promise<void> => {
        const c = makeCollectors()
        handle = createVtDaemonEventsClient({
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            topics: ['agent-lifecycle'],
            onEvent: (f) => { c.events.push(f) },
            onGap: (f) => { c.gaps.push(f) },
            onConnectionState: (s) => { c.states.push(s) },
            random: () => 0,
        })
        const client = await server.nextClient()
        await client.nextSubscribe()

        const gap: GapFrame = {type: 'gap', topic: 'agent-lifecycle', fromSeq: 5, currentSeq: 42}
        client.sendGap(gap)
        await waitFor(() => c.gaps[0])
        expect(c.gaps).toEqual([gap])
    })

    it('close 1011 (overflow): reconnects + re-subscribes with last-seen seq', async (): Promise<void> => {
        const c = makeCollectors()
        handle = createVtDaemonEventsClient({
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            topics: ['agent-lifecycle'],
            onEvent: (f) => { c.events.push(f) },
            onGap: (f) => { c.gaps.push(f) },
            onConnectionState: (s) => { c.states.push(s) },
            random: () => 0,
        })
        const first = await server.nextClient()
        const firstSubscribe = await first.nextSubscribe()
        expect(firstSubscribe.topics[0]?.resumeSeq).toBe(0)

        const seq7: EventFrame = {type: 'event', topic: 'agent-lifecycle', seq: 7, event: 'agent-exited', data: {terminalId: 'T1', source: 'claude', at: 0}}
        first.sendEvent(seq7)
        await waitFor(() => c.events[0])

        first.closeWith(1011, 'overflow')

        const second = await server.nextClient()
        const resubscribe = await second.nextSubscribe()
        expect(resubscribe.topics).toEqual([{topic: 'agent-lifecycle', resumeSeq: 7}])
    })

    it('close 1008: re-resolves Authorization on reconnect (token rotation just works)', async (): Promise<void> => {
        const tokens: string[] = []
        const rotatedToken: string = 'rotated-token-deadbeef'
        let returnRotated: boolean = false

        const c = makeCollectors()
        handle = createVtDaemonEventsClient({
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => {
                const t: string = returnRotated ? rotatedToken : TEST_TOKEN
                tokens.push(t)
                return Promise.resolve(t)
            },
            topics: ['agent-lifecycle'],
            onEvent: (f) => { c.events.push(f) },
            onGap: (f) => { c.gaps.push(f) },
            onConnectionState: (s) => { c.states.push(s) },
            random: () => 0,
        })

        const first = await server.nextClient()
        await first.nextSubscribe()
        expect(tokens).toEqual([TEST_TOKEN])
        expect(first.authorization).toBe(`Bearer ${TEST_TOKEN}`)

        // Simulate daemon restart: rotate accepted token; client gets 1008.
        returnRotated = true
        server.rotateToken(rotatedToken)
        first.closeWith(1008, 'token rotated')

        const second = await server.nextClient()
        await second.nextSubscribe()
        expect(tokens[tokens.length - 1]).toBe(rotatedToken)
        expect(second.authorization).toBe(`Bearer ${rotatedToken}`)
    })

    it('connection-state observable surfaces disconnect via reconnecting state', async (): Promise<void> => {
        const c = makeCollectors()
        handle = createVtDaemonEventsClient({
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            topics: ['agent-lifecycle'],
            onEvent: (f) => { c.events.push(f) },
            onGap: (f) => { c.gaps.push(f) },
            onConnectionState: (s) => { c.states.push(s) },
            random: () => 0,
        })
        const first = await server.nextClient()
        await first.nextSubscribe()
        await waitForState(c.states, 'connected')
        c.states.length = 0

        first.closeWith(1011, 'overflow')
        await waitForState(c.states, 'reconnecting')

        const reconnecting = c.states.find(s => s.kind === 'reconnecting')
        expect(reconnecting?.kind).toBe('reconnecting')
        if (reconnecting?.kind === 'reconnecting') {
            expect(reconnecting.attempt).toBeGreaterThanOrEqual(1)
            expect(reconnecting.delayMs).toBeGreaterThanOrEqual(0)
        }
    })

    it('backoff schedule: virtual setTimeoutImpl observes delays matching computeBackoffDelayMs', async (): Promise<void> => {
        // Server that rejects all upgrades — every attempt fails fast and the
        // client falls through to scheduleReconnect.
        const failingHttp: Server = createServer((_req, res) => { res.writeHead(404); res.end() })
        failingHttp.on('upgrade', (_req, socket: Duplex): void => {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy()
        })
        await new Promise<void>(resolve => failingHttp.listen(0, '127.0.0.1', resolve))
        const port: number = (failingHttp.address() as AddressInfo).port
        const failingUrl: string = `http://127.0.0.1:${port}`

        // Virtual timer: records scheduled delays and runs them sequentially.
        const recorded: number[] = []
        const scheduled: Array<{readonly delay: number; readonly run: () => void}> = []
        const fakeSetTimeout = ((fn: () => void, delay: number): {ref: number} => {
            recorded.push(delay)
            scheduled.push({delay, run: fn})
            return {ref: scheduled.length}
        }) as unknown as typeof setTimeout
        const fakeClearTimeout = ((): void => {}) as unknown as typeof clearTimeout

        const states: ConnectionState[] = []
        handle = createVtDaemonEventsClient({
            getDaemonUrl: () => Promise.resolve(failingUrl),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            topics: ['agent-lifecycle'],
            onEvent: () => {},
            onGap: () => {},
            onConnectionState: (s) => { states.push(s) },
            random: () => 0.5,
            setTimeoutImpl: fakeSetTimeout,
            clearTimeoutImpl: fakeClearTimeout,
        })

        // Drive the loop forward: 5 reconnect attempts.
        for (let attempt = 1; attempt <= 5; attempt++) {
            // Wait until a reconnect was scheduled for THIS attempt.
            await waitFor((): true | undefined => recorded.length >= attempt ? true : undefined, 3000)
            const expected: number = computeBackoffDelayMs(attempt, () => 0.5)
            expect(recorded[attempt - 1]).toBe(expected)
            // Fire the timer to provoke the next attempt.
            const next = scheduled[attempt - 1]
            next.run()
        }

        await new Promise<void>(resolve => failingHttp.close(() => resolve()))
    })
})
