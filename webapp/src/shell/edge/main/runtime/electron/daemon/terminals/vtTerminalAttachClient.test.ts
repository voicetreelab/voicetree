/**
 * Black-box tests for createVtTerminalAttachClient against a real Node `ws`
 * WebSocketServer. Assertions only on observable side effects.
 */
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createServer, type IncomingMessage, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import type {Duplex} from 'node:stream'
import {WebSocket, WebSocketServer} from 'ws'
import type {RelayConnectionStatus} from '@/core/terminal/relayConnectionStatus'
import {attachUrlFromDaemonUrl, createVtTerminalAttachClient, type VtTerminalAttachClient} from './vtTerminalAttachClient'

const TEST_TOKEN: string = 'cafef00d'
const TERMINAL_ID: string = 't-12345'
const ATTACH_PATH_RE: RegExp = /^\/terminals\/[^/]+\/attach$/

interface StubServer {
    readonly url: string
    /** Resolves with the auth header for the next inbound upgrade. */
    readonly nextUpgrade: () => Promise<{authorization: string; url: string}>
    /** Resolves with the next data frame received from the client. */
    readonly nextFrame: () => Promise<unknown>
    /** Push a data frame down to the client. */
    readonly pushData: (payload: string) => void
    /** Close the active client WS connection. */
    readonly closeActive: (code?: number, reason?: string) => void
    readonly close: () => Promise<void>
}

async function startStubAttachServer(token: string): Promise<StubServer> {
    const httpServer: Server = createServer((_req, res) => { res.writeHead(404); res.end() })
    const wss: WebSocketServer = new WebSocketServer({noServer: true})
    let activeWs: WebSocket | null = null
    const upgradeResolvers: Array<(v: {authorization: string; url: string}) => void> = []
    const frameResolvers: Array<(v: unknown) => void> = []
    const frameBuffer: unknown[] = []

    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        if (!req.url || !ATTACH_PATH_RE.test(req.url.replace(/\?.*$/, ''))) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return
        }
        const auth: string = (req.headers.authorization ?? '') as string
        if (auth !== `Bearer ${token}`) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return
        }
        const captured = {authorization: auth, url: req.url}
        wss.handleUpgrade(req, socket, head, (ws: WebSocket): void => {
            activeWs = ws
            ws.on('close', () => { if (activeWs === ws) activeWs = null })
            ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]): void => {
                const text: string = Buffer.isBuffer(raw) ? raw.toString('utf-8')
                    : Array.isArray(raw) ? Buffer.concat(raw).toString('utf-8')
                    : Buffer.from(raw as ArrayBuffer).toString('utf-8')
                let parsed: unknown = null
                try { parsed = JSON.parse(text) } catch { /* leave null */ }
                const r = frameResolvers.shift()
                if (r) r(parsed); else frameBuffer.push(parsed)
            })
            upgradeResolvers.shift()?.(captured)
        })
    })

    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve))
    const port: number = (httpServer.address() as AddressInfo).port

    return {
        url: `http://127.0.0.1:${port}`,
        nextUpgrade: (): Promise<{authorization: string; url: string}> =>
            new Promise(resolve => upgradeResolvers.push(resolve)),
        nextFrame: (): Promise<unknown> => {
            const buffered = frameBuffer.shift()
            if (buffered !== undefined) return Promise.resolve(buffered)
            return new Promise(resolve => frameResolvers.push(resolve))
        },
        pushData: (payload: string): void => {
            if (activeWs && activeWs.readyState === WebSocket.OPEN) {
                activeWs.send(JSON.stringify({type: 'data', payload}))
            }
        },
        closeActive: (code?: number, reason?: string): void => {
            // ws.close() forbids 1006 (reserved for abnormal-close detection).
            activeWs?.close(code ?? 1011, reason ?? '')
        },
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
        const v: T | undefined = fn()
        if (v !== undefined) return v
        await new Promise(r => setTimeout(r, 5))
    }
    throw new Error('timed out waiting for condition')
}

describe('createVtTerminalAttachClient', (): void => {
    let server: StubServer
    let client: VtTerminalAttachClient | null = null

    beforeEach(async (): Promise<void> => {
        server = await startStubAttachServer(TEST_TOKEN)
    })

    afterEach(async (): Promise<void> => {
        client?.dispose()
        client = null
        await server.close()
    })

    it('upgrades with Authorization: Bearer <token> on the /terminals/:id/attach path', async (): Promise<void> => {
        const statuses: RelayConnectionStatus[] = []
        client = createVtTerminalAttachClient({
            terminalId: TERMINAL_ID,
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            onData: () => {},
            onStatus: (s) => { statuses.push(s) },
        })
        const upgrade = await server.nextUpgrade()
        expect(upgrade.authorization).toBe(`Bearer ${TEST_TOKEN}`)
        expect(upgrade.url).toMatch(new RegExp(`^/terminals/${TERMINAL_ID}/attach`))
        await waitFor(() => statuses.find(s => s === 'connected'))
    })

    it('sendData reaches the server as {type:"data",payload}', async (): Promise<void> => {
        const statuses: RelayConnectionStatus[] = []
        client = createVtTerminalAttachClient({
            terminalId: TERMINAL_ID,
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            onData: () => {},
            onStatus: (s) => { statuses.push(s) },
        })
        await server.nextUpgrade()
        await waitFor(() => statuses.find(s => s === 'connected'))
        expect(client.sendData('hello')).toBe(true)
        const frame = await server.nextFrame()
        expect(frame).toEqual({type: 'data', payload: 'hello'})
    })

    it('sendResize reaches the server as {type:"resize",cols,rows}', async (): Promise<void> => {
        const statuses: RelayConnectionStatus[] = []
        client = createVtTerminalAttachClient({
            terminalId: TERMINAL_ID,
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            onData: () => {},
            onStatus: (s) => { statuses.push(s) },
        })
        await server.nextUpgrade()
        await waitFor(() => statuses.find(s => s === 'connected'))
        expect(client.sendResize(101, 33)).toBe(true)
        const frame = await server.nextFrame()
        expect(frame).toEqual({type: 'resize', cols: 101, rows: 33})
    })

    it('server-side data frame triggers onData with the payload', async (): Promise<void> => {
        const data: string[] = []
        const statuses: RelayConnectionStatus[] = []
        client = createVtTerminalAttachClient({
            terminalId: TERMINAL_ID,
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            onData: (d) => { data.push(d) },
            onStatus: (s) => { statuses.push(s) },
        })
        await server.nextUpgrade()
        await waitFor(() => statuses.find(s => s === 'connected'))
        server.pushData('world')
        await waitFor(() => data[0])
        expect(data).toEqual(['world'])
    })

    it('server close triggers reconnecting status and re-issues Authorization on reconnect', async (): Promise<void> => {
        const statuses: RelayConnectionStatus[] = []
        const tokensIssued: string[] = []
        client = createVtTerminalAttachClient({
            terminalId: TERMINAL_ID,
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => {
                tokensIssued.push(TEST_TOKEN)
                return Promise.resolve(TEST_TOKEN)
            },
            onData: () => {},
            onStatus: (s) => { statuses.push(s) },
        })
        const first = await server.nextUpgrade()
        expect(first.authorization).toBe(`Bearer ${TEST_TOKEN}`)
        await waitFor(() => statuses.find(s => s === 'connected'))

        server.closeActive(1011, 'gone')

        const second = await server.nextUpgrade()
        expect(second.authorization).toBe(`Bearer ${TEST_TOKEN}`)
        expect(tokensIssued.length).toBeGreaterThanOrEqual(2)
        expect(statuses).toContain('reconnecting')
    })

    it('reconnect schedule via virtual setTimeoutImpl: 200, 400, 800, 1600, 3200, 5000, 5000', async (): Promise<void> => {
        // Server that always rejects upgrades — connect-level failure drives the
        // reconnect path; closures from a successful connect also drive the same
        // schedule. Both surface the same backoff curve.
        const failing: Server = createServer((_req, res) => { res.writeHead(404); res.end() })
        failing.on('upgrade', (_req, socket: Duplex): void => {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy()
        })
        await new Promise<void>(resolve => failing.listen(0, '127.0.0.1', resolve))
        const port: number = (failing.address() as AddressInfo).port

        const recorded: number[] = []
        const scheduled: Array<{readonly delay: number; readonly run: () => void}> = []
        const fakeSetTimeout = ((fn: () => void, delay: number): {ref: number} => {
            recorded.push(delay)
            scheduled.push({delay, run: fn})
            return {ref: scheduled.length}
        }) as unknown as typeof setTimeout
        const fakeClearTimeout = ((): void => {}) as unknown as typeof clearTimeout

        client = createVtTerminalAttachClient({
            terminalId: TERMINAL_ID,
            getDaemonUrl: () => Promise.resolve(`http://127.0.0.1:${port}`),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            onData: () => {},
            onStatus: () => {},
            setTimeoutImpl: fakeSetTimeout,
            clearTimeoutImpl: fakeClearTimeout,
        })

        const expected: readonly number[] = [200, 400, 800, 1600, 3200, 5000, 5000]
        for (let i = 0; i < expected.length; i++) {
            await waitFor((): true | undefined => recorded.length > i ? true : undefined, 3000)
            expect(recorded[i]).toBe(expected[i])
            scheduled[i].run()
        }

        await new Promise<void>(resolve => failing.close(() => resolve()))
    })
})

describe('attachUrlFromDaemonUrl', (): void => {
    it('switches http→ws and url-encodes the terminal id', (): void => {
        expect(attachUrlFromDaemonUrl('http://127.0.0.1:51337', 'tid abc')).toBe('ws://127.0.0.1:51337/terminals/tid%20abc/attach')
        expect(attachUrlFromDaemonUrl('https://example.com', 'plain')).toBe('wss://example.com/terminals/plain/attach')
    })
})
