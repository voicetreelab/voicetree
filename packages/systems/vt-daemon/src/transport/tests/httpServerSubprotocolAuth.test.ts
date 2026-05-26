// Black-box tests for the `vt-bearer` subprotocol auth path on WS upgrade
// (Step 9b.1). Brings up a real http.createServer and exercises the upgrade
// via real RFC 6455 round-trips — `ws` for high-level cases, raw http.request
// for verifying the 101 response headers when the ws client lib would
// post-handshake-error.
//
// Spec sources:
//   - ctx-nodes/.../step9-design-override-ws-subprotocol-auth.md (Gus override)
//   - ctx-nodes/.../step9e-surprise-auth-wire.md (Iris's 5-point handoff contract)
//   - docs/step9-design.md §4.3 (out of date; 9g formally amends)

import http, {type IncomingMessage} from 'node:http'
import {randomBytes} from 'node:crypto'

import {afterEach, describe, expect, it} from 'vitest'
import {WebSocket} from 'ws'

import {generateAuthToken} from '@vt/vt-rpc'

import {startHttpDaemonServer, type HookHandler, type HttpDaemonServerHandle, type ToolCatalog} from '../httpServer.ts'

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

async function bring(): Promise<Ctx> {
    const token: string = generateAuthToken()
    const handle: HttpDaemonServerHandle = await startHttpDaemonServer({
        catalog: new Map() as ToolCatalog,
        hookHandler: noopHook,
        token,
        bindHost: '127.0.0.1',
        logger: {logRequest: (): void => {}, logError: (): void => {}},
    })
    const ctx: Ctx = {handle, token}
    active.push(ctx)
    return ctx
}

function wsUrlFor(handle: HttpDaemonServerHandle, path: string): string {
    return handle.url.replace(/^http/, 'ws') + path
}

interface RawUpgradeResult {
    readonly statusCode: number | undefined
    readonly subprotocolHeader: string | string[] | undefined
}

// Drives a raw RFC 6455 upgrade request with arbitrary headers and resolves
// once the server has responded — either with a 101 (captured via 'upgrade')
// or any other status code (captured via 'response'). Lets us inspect the
// 101 response headers in scenarios where the `ws` client lib would error
// post-handshake on a protocol mismatch.
function rawUpgrade(handle: HttpDaemonServerHandle, path: string, headers: Record<string, string>): Promise<RawUpgradeResult> {
    const url: URL = new URL(handle.url)
    return new Promise<RawUpgradeResult>((resolveResult, rejectResult): void => {
        const req: http.ClientRequest = http.request({
            hostname: url.hostname,
            port: Number(url.port),
            path,
            method: 'GET',
            headers: {
                'Connection': 'Upgrade',
                'Upgrade': 'websocket',
                'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
                'Sec-WebSocket-Version': '13',
                ...headers,
            },
        })
        req.on('upgrade', (res: IncomingMessage, socket: import('node:stream').Duplex): void => {
            const subprotocolHeader: string | string[] | undefined = res.headers['sec-websocket-protocol']
            socket.destroy()
            resolveResult({statusCode: res.statusCode, subprotocolHeader})
        })
        req.on('response', (res: IncomingMessage): void => {
            res.resume()
            resolveResult({statusCode: res.statusCode, subprotocolHeader: res.headers['sec-websocket-protocol']})
        })
        req.on('error', rejectResult)
        req.end()
    })
}

describe('GET /events — vt-bearer subprotocol auth (Step 9b.1)', (): void => {
    it('1. valid subprotocol → 101, echoes Sec-WebSocket-Protocol: vt-bearer, end-to-end works', async (): Promise<void> => {
        const {handle, token} = await bring()
        const ws = new WebSocket(wsUrlFor(handle, '/events'), ['vt-bearer', token])
        const received: string[] = []
        await new Promise<void>((r): void => { ws.once('open', (): void => r()) })
        expect(ws.protocol).toBe('vt-bearer')

        ws.on('message', (raw: Buffer): void => { received.push(raw.toString('utf8')) })
        ws.send(JSON.stringify({op: 'subscribe', topics: [{topic: 'agent-lifecycle'}]}))
        await new Promise<void>((r): void => { setTimeout((): void => r(), 50) })
        handle.hub.publish('agent-lifecycle', 'agent-spawned', {terminalId: 'T1'})
        await new Promise<void>((r): void => { setTimeout((): void => r(), 100) })
        ws.close()

        expect(received).toHaveLength(1)
        const event = JSON.parse(received[0]) as {topic: string; event: string}
        expect(event).toMatchObject({topic: 'agent-lifecycle', event: 'agent-spawned'})
    })

    it('2. valid literal + wrong token → 401 before handshake', async (): Promise<void> => {
        const {handle} = await bring()
        const result: RawUpgradeResult = await rawUpgrade(handle, '/events', {
            'Sec-WebSocket-Protocol': `vt-bearer, ${'deadbeef'.repeat(8)}`,
        })
        expect(result.statusCode).toBe(401)
        expect(result.subprotocolHeader).toBeUndefined()
    })

    it('3. single subprotocol value (no token) → 401', async (): Promise<void> => {
        const {handle} = await bring()
        const result: RawUpgradeResult = await rawUpgrade(handle, '/events', {
            'Sec-WebSocket-Protocol': 'vt-bearer',
        })
        expect(result.statusCode).toBe(401)
    })

    it('4. wrong literal "foo, <token>" → 401', async (): Promise<void> => {
        const {handle, token} = await bring()
        const result: RawUpgradeResult = await rawUpgrade(handle, '/events', {
            'Sec-WebSocket-Protocol': `foo, ${token}`,
        })
        expect(result.statusCode).toBe(401)
    })

    it('5. three values "vt-bearer, <token>, extra" → 401', async (): Promise<void> => {
        const {handle, token} = await bring()
        const result: RawUpgradeResult = await rawUpgrade(handle, '/events', {
            'Sec-WebSocket-Protocol': `vt-bearer, ${token}, extra`,
        })
        expect(result.statusCode).toBe(401)
    })

    it('6. valid Authorization header + WRONG subprotocol token → 101, NO subprotocol echoed (Authorization wins)', async (): Promise<void> => {
        const {handle, token} = await bring()
        const result: RawUpgradeResult = await rawUpgrade(handle, '/events', {
            'Authorization': `Bearer ${token}`,
            'Sec-WebSocket-Protocol': `vt-bearer, ${'cafef00d'.repeat(8)}`,
        })
        expect(result.statusCode).toBe(101)
        expect(result.subprotocolHeader).toBeUndefined()
    })

    it('7. no Authorization AND no Sec-WebSocket-Protocol → 401', async (): Promise<void> => {
        const {handle} = await bring()
        const result: RawUpgradeResult = await rawUpgrade(handle, '/events', {})
        expect(result.statusCode).toBe(401)
    })
})

describe('GET /terminals/:id/attach — subprotocol auth on wired tmux relay (Step 9f)', (): void => {
    it('8. valid subprotocol → 101 + vt-bearer echoed on the wired attach route', async (): Promise<void> => {
        // Renderer-shape contract pin: ws upgrade via `new WebSocket(url,
        // ['vt-bearer', token])` succeeds with 101 + subprotocol echo, same
        // wire shape as test #1 (/events). Bytes flow + paste tested in
        // tmuxAttachWiring.test.ts (needs a real tmux binary).
        const {handle, token} = await bring()
        const wsUrl: string = wsUrlFor(handle, '/terminals/T1/attach?cols=120&rows=40')
        await new Promise<void>((resolveTest, rejectTest): void => {
            const ws = new WebSocket(wsUrl, ['vt-bearer', token])
            ws.on('open', (): void => {
                try {
                    expect(ws.protocol).toBe('vt-bearer')
                    ws.close()
                    resolveTest()
                } catch (cause) {
                    rejectTest(cause as Error)
                }
            })
            ws.on('unexpected-response', (_req, res): void => {
                rejectTest(new Error(`expected 101 upgrade, got ${res.statusCode}`))
            })
            ws.on('error', (cause: Error): void => rejectTest(cause))
        })
    })
})

// Cross-wire renderer smoke (Step 9 Phase 1 gate, ahead of the atomic merge).
//
// Test #1 above already exercises subscribe→publish→receive via `new
// WebSocket(url, ['vt-bearer', token])`, but it uses the Node EventEmitter
// surface (`ws.on('open', …)`, `ws.on('message', raw: Buffer)`) — which is
// NOT what the renderer can use under `contextIsolation=on` / `nodeIntegration=off`.
//
// This test pins the renderer-side wire shape: pure W3C/browser WebSocket
// API (`addEventListener`, `MessageEvent.data` as a string, `.protocol` read
// via the standard property). Proves a client constrained to browser-shape
// methods authenticates via the subprotocol path and exchanges frames
// end-to-end against the real startHttpDaemonServer — no internal mocks.
describe('cross-wire renderer smoke — browser-shape WebSocket against real daemon', (): void => {
    it('9. renderer (W3C API only) → 101 + subprotocol echo + subscribe → publish → receive', async (): Promise<void> => {
        const {handle, token} = await bring()
        const ws = new WebSocket(wsUrlFor(handle, '/events'), ['vt-bearer', token])
        const received: string[] = []

        await new Promise<void>((resolveOpen, rejectOpen): void => {
            ws.addEventListener('open', (): void => resolveOpen())
            ws.addEventListener('error', (): void => rejectOpen(new Error('renderer ws errored before open')))
        })

        // W3C surface: negotiated subprotocol is read via the standard `.protocol`
        // property — same name and shape as window.WebSocket in the renderer.
        expect(ws.protocol).toBe('vt-bearer')

        ws.addEventListener('message', (ev: WebSocket.MessageEvent): void => {
            // Text frames arrive as `ev.data: string` under the W3C API —
            // identical to what the renderer's window.WebSocket sees.
            if (typeof ev.data !== 'string') {
                throw new Error(`renderer text frame should arrive as string, got ${typeof ev.data}`)
            }
            received.push(ev.data)
        })

        ws.send(JSON.stringify({op: 'subscribe', topics: [{topic: 'agent-lifecycle'}]}))
        await new Promise<void>((r): void => { setTimeout((): void => r(), 50) })
        handle.hub.publish('agent-lifecycle', 'agent-spawned', {terminalId: 'T-renderer-smoke'})
        await new Promise<void>((r): void => { setTimeout((): void => r(), 100) })
        ws.close()

        expect(received).toHaveLength(1)
        const event = JSON.parse(received[0]) as {topic: string; event: string; data: {terminalId: string}}
        expect(event).toMatchObject({
            topic: 'agent-lifecycle',
            event: 'agent-spawned',
            data: {terminalId: 'T-renderer-smoke'},
        })
    })
})
