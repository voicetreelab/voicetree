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

import {startHttpDaemonServer, type HookHandler, type HttpDaemonServerHandle, type ToolCatalog} from '../httpServer.ts'
import {generateAuthToken} from '../authToken.ts'

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
        ws.send(JSON.stringify({op: 'subscribe', topics: [{topic: 'vault-state'}]}))
        await new Promise<void>((r): void => { setTimeout((): void => r(), 50) })
        handle.hub.publish('vault-state', 'file-added', {path: '/v/x.md'})
        await new Promise<void>((r): void => { setTimeout((): void => r(), 100) })
        ws.close()

        expect(received).toHaveLength(1)
        const event = JSON.parse(received[0]) as {topic: string; event: string}
        expect(event).toMatchObject({topic: 'vault-state', event: 'file-added'})
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

describe('GET /terminals/:id/attach — subprotocol auth also reaches the 9f stub', (): void => {
    it('8. valid subprotocol on the stubbed attach route → 503 (auth passes, route gated)', async (): Promise<void> => {
        const {handle, token} = await bring()
        const wsUrl: string = wsUrlFor(handle, '/terminals/T1/attach')
        await new Promise<void>((resolveTest, rejectTest): void => {
            const ws = new WebSocket(wsUrl, ['vt-bearer', token])
            ws.on('open', (): void => rejectTest(new Error('expected the upgrade to be rejected, not completed')))
            ws.on('unexpected-response', (_req, res): void => {
                try {
                    expect(res.statusCode).toBe(503)
                    resolveTest()
                } catch (cause) {
                    rejectTest(cause as Error)
                }
            })
            ws.on('error', (): void => { /* unexpected-response decides */ })
        })
    })
})
