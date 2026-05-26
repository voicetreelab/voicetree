// Black-box tests for the unified HTTP daemon server. Each test brings up a
// real http.createServer (via startHttpDaemonServer) on port 0, exercises a
// route via fetch / ws, and asserts on the observable wire. No spies, no
// internal mocks — the wire is the contract.
//
// Acceptance criteria pinned to design doc §4 / §8 / brief Scope B:
//   - RPC success + JSON-RPC error round-trip
//   - 401 on missing/wrong token (both routes)
//   - Access log redacts Authorization header (unit-tested via buildAccessLogLine)
//   - WS bad-token-upgrade rejected before WS handshake completes
//   - WS subscribe → publish → receive
//   - Resume buffer covers ~100 events
//   - Overflow close 1011 (asserted via hub-level test; not re-asserted here)
//   - Oversized inbound WS frame close 1009 (256 KiB ceiling)

import {afterEach, describe, expect, it} from 'vitest'
import {WebSocket} from 'ws'

import {generateAuthToken} from '@vt/vt-rpc'

import {buildJsonResponse, type McpToolResponse} from '../../tools/toolResponse.ts'
import {buildAccessLogLine, startHttpDaemonServer, type HookHandler, type HttpDaemonServerHandle, type ToolCatalog} from '../httpServer.ts'

const noopHook: HookHandler = (): unknown => ({ok: true})

interface Ctx {
    handle: HttpDaemonServerHandle
    token: string
}

const active: Ctx[] = []

afterEach(async (): Promise<void> => {
    while (active.length > 0) {
        const c: Ctx = active.pop()!
        await c.handle.stop().catch((): void => {})
    }
})

async function bring(catalog: ToolCatalog, hookHandler: HookHandler = noopHook): Promise<Ctx> {
    const token: string = generateAuthToken()
    const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog,
        hookHandler,
        token,
        bindHost: '127.0.0.1',
        logger: {logRequest: (): void => {}, logError: (): void => {}},
    })
    const ctx: Ctx = {handle, token}
    active.push(ctx)
    return ctx
}

describe('POST /rpc — JSON-RPC dispatch', (): void => {
    it('round-trips a JSON-RPC success', async (): Promise<void> => {
        const catalog: ToolCatalog = new Map<string, (a: Record<string, unknown>) => Promise<McpToolResponse>>([
            ['echo', async (args): Promise<McpToolResponse> => buildJsonResponse({echoed: args})],
        ])
        const {handle, token} = await bring(catalog)
        const res = await fetch(`${handle.url}/rpc`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({jsonrpc: '2.0', method: 'echo', params: {x: 1}, id: 42}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {jsonrpc: string; id: number; result: {echoed: {x: number}}}
        expect(body).toEqual({jsonrpc: '2.0', id: 42, result: {echoed: {x: 1}}})
    })

    it('reports JSON-RPC error in body with HTTP 200 (unknown method → -32601)', async (): Promise<void> => {
        const {handle, token} = await bring(new Map())
        const res = await fetch(`${handle.url}/rpc`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({jsonrpc: '2.0', method: 'missing_tool', params: {}, id: 1}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {error: {code: number; message: string}}
        expect(body.error.code).toBe(-32601)
        expect(body.error.message).toContain('missing_tool')
    })

    it('rejects missing bearer with HTTP 401, empty body', async (): Promise<void> => {
        const {handle} = await bring(new Map())
        const res = await fetch(`${handle.url}/rpc`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({jsonrpc: '2.0', method: 'x', id: 1}),
        })
        expect(res.status).toBe(401)
        expect(await res.text()).toBe('')
    })

    it('rejects wrong bearer with HTTP 401', async (): Promise<void> => {
        const {handle} = await bring(new Map())
        const res = await fetch(`${handle.url}/rpc`, {
            method: 'POST',
            headers: {Authorization: 'Bearer wrong-token', 'Content-Type': 'application/json'},
            body: JSON.stringify({jsonrpc: '2.0', method: 'x', id: 1}),
        })
        expect(res.status).toBe(401)
    })

    it('413 on body over 64 KiB', async (): Promise<void> => {
        const {handle, token} = await bring(new Map())
        const big: string = 'A'.repeat(70_000)
        const res = await fetch(`${handle.url}/rpc`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({jsonrpc: '2.0', method: 'x', params: {payload: big}, id: 1}),
        })
        expect(res.status).toBe(413)
    })

    it('parse_error envelope on malformed JSON body', async (): Promise<void> => {
        const {handle, token} = await bring(new Map())
        const res = await fetch(`${handle.url}/rpc`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: '{not json',
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {error: {code: number}}
        expect(body.error.code).toBe(-32700)
    })
})

describe('POST /hook/:source — agent lifecycle ingestion', (): void => {
    it('routes to the configured handler', async (): Promise<void> => {
        const seen: Array<{source: string; terminalId: string | undefined; eventName: string | undefined}> = []
        const hookHandler: HookHandler = (input): unknown => {
            seen.push({source: input.source, terminalId: input.terminalId, eventName: input.eventName})
            return {ok: true}
        }
        const {handle, token} = await bring(new Map(), hookHandler)
        const res = await fetch(`${handle.url}/hook/claude-code?terminal=T1&event=Stop`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({hook_event_name: 'Stop'}),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as {ok: boolean}
        expect(body.ok).toBe(true)
        expect(seen).toEqual([{source: 'claude-code', terminalId: 'T1', eventName: 'Stop'}])
    })

    it('rejects missing bearer with 401 (route is gated)', async (): Promise<void> => {
        const {handle} = await bring(new Map())
        const res = await fetch(`${handle.url}/hook/claude-code`, {method: 'POST', body: '{}'})
        expect(res.status).toBe(401)
    })

    it('publishes an agent-lifecycle event to subscribers', async (): Promise<void> => {
        const hookHandler: HookHandler = (): unknown => ({ok: true})
        const {handle, token} = await bring(new Map(), hookHandler)
        const events: Array<{topic: string; event: string; data: unknown}> = []
        const sub = handle.hub.addSubscriber({
            send: (frame: string): void => {
                const parsed: {topic: string; event: string; data: unknown} = JSON.parse(frame)
                events.push(parsed)
            },
            overflow: (): void => {},
        })
        sub.subscribe([{topic: 'agent-lifecycle'}])

        await fetch(`${handle.url}/hook/claude-code?terminal=T2&event=Stop`, {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: '{}',
        })
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({topic: 'agent-lifecycle', event: 'Stop'})
        const data = events[0].data as {terminalId: string; source: string}
        expect(data.terminalId).toBe('T2')
        expect(data.source).toBe('claude-code')
    })
})

describe('unknown / other transport-layer responses', (): void => {
    it('404 on an unknown route', async (): Promise<void> => {
        const {handle, token} = await bring(new Map())
        const res = await fetch(`${handle.url}/nope`, {
            method: 'GET',
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(res.status).toBe(404)
    })

    it('405 on wrong method to a known route', async (): Promise<void> => {
        const {handle, token} = await bring(new Map())
        const res = await fetch(`${handle.url}/rpc`, {
            method: 'GET',
            headers: {Authorization: `Bearer ${token}`},
        })
        expect(res.status).toBe(405)
    })

    it('204 on OPTIONS (no CORS preflight; auth still gates other verbs)', async (): Promise<void> => {
        const {handle} = await bring(new Map())
        const res = await fetch(`${handle.url}/rpc`, {method: 'OPTIONS'})
        expect(res.status).toBe(204)
    })
})

describe('access log redaction (design doc §3.3, R5)', (): void => {
    it('redacts the Authorization header — keeps only the last 4 of the token', (): void => {
        const fakeReq = {
            method: 'POST',
            url: '/rpc',
            headers: {authorization: 'Bearer abcdef0123456789'},
        } as unknown as Parameters<typeof buildAccessLogLine>[0]
        const line: string = buildAccessLogLine(fakeReq, 200)
        expect(line).toContain('authorization="Bearer ****6789"')
        expect(line).not.toContain('abcdef0123456789')
    })

    it('logs <none> when the Authorization header is absent', (): void => {
        const fakeReq = {
            method: 'POST',
            url: '/rpc',
            headers: {},
        } as unknown as Parameters<typeof buildAccessLogLine>[0]
        const line: string = buildAccessLogLine(fakeReq, 401)
        expect(line).toContain('authorization="<none>"')
    })
})

describe('GET /terminals/:id/attach — wired tmux relay (Step 9f)', (): void => {
    it('rejects the WS upgrade with 401 BEFORE handshake on bad bearer (auth gate)', async (): Promise<void> => {
        const {handle} = await bring(new Map())
        const wsUrl: string = handle.url.replace(/^http/, 'ws') + '/terminals/T1/attach'
        await new Promise<void>((resolveTest, rejectTest): void => {
            const ws = new WebSocket(wsUrl, {headers: {Authorization: 'Bearer wrong'}})
            ws.on('open', (): void => rejectTest(new Error('upgrade should be rejected before handshake')))
            ws.on('unexpected-response', (_req, res): void => {
                try {
                    expect(res.statusCode).toBe(401)
                    resolveTest()
                } catch (cause) {
                    rejectTest(cause as Error)
                }
            })
            ws.on('error', (): void => {})
        })
    })

    it('accepts the upgrade (101) on a valid Authorization header — end-to-end exercised in tmuxAttachWiring.test.ts', async (): Promise<void> => {
        // This anchor pins ONLY the route-flip from 503→101 with header auth.
        // The end-to-end bytes-flow contract (real tmux session + paste + resize)
        // lives in tmuxAttachWiring.test.ts so this suite stays fast and free
        // of a tmux binary dependency.
        const {handle, token} = await bring(new Map())
        const wsUrl: string = handle.url.replace(/^http/, 'ws') + '/terminals/nonexistent-session/attach?cols=120&rows=40'
        await new Promise<void>((resolveTest, rejectTest): void => {
            const ws = new WebSocket(wsUrl, {headers: {Authorization: `Bearer ${token}`}})
            ws.on('open', (): void => {
                ws.close()
                resolveTest()
            })
            ws.on('unexpected-response', (_req, res): void => {
                rejectTest(new Error(`expected 101 upgrade, got ${res.statusCode}`))
            })
            ws.on('error', (cause: Error): void => rejectTest(cause))
        })
    })
})

describe('GET /events — WebSocket subscription', (): void => {
    it('rejects upgrade with 401 BEFORE the WS handshake completes (design doc §4.3)', async (): Promise<void> => {
        const {handle} = await bring(new Map())
        const wsUrl: string = handle.url.replace(/^http/, 'ws') + '/events'
        await new Promise<void>((resolveTest, rejectTest): void => {
            const ws = new WebSocket(wsUrl, {headers: {Authorization: 'Bearer wrong'}})
            ws.on('open', (): void => rejectTest(new Error('upgrade should be rejected before handshake')))
            ws.on('unexpected-response', (_req, res): void => {
                try {
                    expect(res.statusCode).toBe(401)
                    resolveTest()
                } catch (cause) {
                    rejectTest(cause as Error)
                }
            })
            ws.on('error', (): void => {})
        })
    })

    it('subscribe → publish → receive end-to-end', async (): Promise<void> => {
        const {handle, token} = await bring(new Map())
        const wsUrl: string = handle.url.replace(/^http/, 'ws') + '/events'
        const ws = new WebSocket(wsUrl, {headers: {Authorization: `Bearer ${token}`}})
        const received: string[] = []
        const opened: Promise<void> = new Promise((r): void => { ws.once('open', (): void => r()) })
        ws.on('message', (raw: Buffer): void => { received.push(raw.toString('utf8')) })
        await opened

        ws.send(JSON.stringify({op: 'subscribe', topics: [{topic: 'agent-lifecycle'}]}))
        // Allow the server to register the subscription.
        await new Promise<void>((r): void => { setTimeout((): void => r(), 50) })
        handle.hub.publish('agent-lifecycle', 'agent-spawned', {terminalId: 'T1'})
        // Allow time for the event to arrive over the loopback WS.
        await new Promise<void>((r): void => { setTimeout((): void => r(), 100) })

        ws.close()
        expect(received).toHaveLength(1)
        const event = JSON.parse(received[0]) as {topic: string; event: string; seq: number}
        expect(event).toMatchObject({topic: 'agent-lifecycle', event: 'agent-spawned', seq: 1})
    })

    it('256 KiB inbound frame cap — server closes with 1009 (design doc §8.6)', async (): Promise<void> => {
        const {handle, token} = await bring(new Map())
        const wsUrl: string = handle.url.replace(/^http/, 'ws') + '/events'
        const ws = new WebSocket(wsUrl, {headers: {Authorization: `Bearer ${token}`}})
        await new Promise<void>((r): void => { ws.once('open', (): void => r()) })

        const closeCode: number = await new Promise<number>((resolveClose): void => {
            ws.once('close', (code: number): void => resolveClose(code))
            // Send a frame larger than 256 KiB to trip the maxPayload cap.
            ws.send('B'.repeat(300 * 1024))
        })
        expect(closeCode).toBe(1009)
    })
})
