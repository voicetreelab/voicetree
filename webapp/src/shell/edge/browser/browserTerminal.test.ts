/**
 * Black-box tests for the browser terminal transport against a real Node `ws`
 * WebSocketServer. Assertions only on observable side effects (what reaches the
 * onData/onStatus listeners, what bytes land on the wire). No internal mocks.
 *
 * The transport calls the global `WebSocket`; jsdom's implementation cannot dial
 * a real server, so we swap in the Node `ws` WebSocket (whose `.onopen/.onmessage`
 * property setters are API-compatible) for the duration of the suite and restore
 * it afterward.
 */
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest'
import {createServer, type IncomingMessage, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import type {Duplex} from 'node:stream'
import {WebSocket, WebSocketServer} from 'ws'
import {createBrowserTerminalRuntime, type BrowserTerminalRuntime} from './browserTerminal'

const TEST_TOKEN: string = 'cafef00d'
const TERMINAL_ID: string = 't-12345'
const ATTACH_PATH_RE: RegExp = /^\/terminals\/[^/]+\/attach$/

interface StubServer {
    readonly url: string
    /** Resolves with the next frame received from the client, JSON-parsed. */
    readonly nextFrame: () => Promise<unknown>
    /** Push a raw (already-serialized) frame to the active client. */
    readonly pushRaw: (raw: string) => void
    readonly close: () => Promise<void>
}

/**
 * @param greetOnConnect when set, the server sends a `{type:'data',payload}`
 *   frame the instant the connection is established — i.e. before the client's
 *   `onopen` fires. Used to reproduce the initial-paint race.
 */
async function startStubAttachServer(token: string, greetOnConnect?: string): Promise<StubServer> {
    const httpServer: Server = createServer((_req, res) => { res.writeHead(404); res.end() })
    const wss: WebSocketServer = new WebSocketServer({noServer: true, handleProtocols: () => 'vt-bearer'})
    let activeWs: WebSocket | null = null
    const frameResolvers: Array<(v: unknown) => void> = []
    const frameBuffer: unknown[] = []

    function tokenFromProtocolHeader(header: string | undefined): string | null {
        if (!header) return null
        const parts: string[] = header.split(',').map(p => p.trim())
        if (parts[0] !== 'vt-bearer' || parts.length < 2) return null
        return parts[1]
    }

    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        if (!req.url || !ATTACH_PATH_RE.test(req.url.replace(/\?.*$/, ''))) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return
        }
        if (tokenFromProtocolHeader(req.headers['sec-websocket-protocol']) !== token) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return
        }
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
            // Emitted before the client's onopen — the initial-paint race window.
            if (greetOnConnect !== undefined) {
                ws.send(JSON.stringify({type: 'data', payload: greetOnConnect}))
            }
        })
    })

    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve))
    const port: number = (httpServer.address() as AddressInfo).port

    return {
        url: `http://127.0.0.1:${port}`,
        nextFrame: (): Promise<unknown> => {
            const buffered = frameBuffer.shift()
            if (buffered !== undefined) return Promise.resolve(buffered)
            return new Promise(resolve => frameResolvers.push(resolve))
        },
        pushRaw: (raw: string): void => {
            if (activeWs && activeWs.readyState === WebSocket.OPEN) activeWs.send(raw)
        },
        close: (): Promise<void> => new Promise<void>((resolve, reject): void => {
            // Terminate the live client so wss.close() can complete even when a
            // test leaves its handle attached.
            activeWs?.terminate()
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

describe('createBrowserTerminalRuntime', (): void => {
    const originalWebSocket = globalThis.WebSocket
    let server: StubServer
    let runtime: BrowserTerminalRuntime

    beforeAll((): void => {
        // The transport dials via the global WebSocket; use the Node `ws` impl.
        globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket
    })
    afterAll((): void => {
        globalThis.WebSocket = originalWebSocket
    })

    beforeEach((): void => {
        runtime = createBrowserTerminalRuntime()
    })
    afterEach(async (): Promise<void> => {
        await server.close()
    })

    it('unwraps a server data frame to the raw payload (not the JSON envelope)', async (): Promise<void> => {
        server = await startStubAttachServer(TEST_TOKEN)
        const data: string[] = []
        const statuses: string[] = []
        const handle = await runtime.attach(server.url, TEST_TOKEN, TERMINAL_ID)
        runtime.onData(handle, d => { data.push(d) })
        runtime.onStatus(handle, s => { statuses.push(s) })

        await waitFor(() => statuses.find(s => s === 'connected'))
        server.pushRaw(JSON.stringify({type: 'data', payload: 'hello'}))
        await waitFor(() => data[0])
        expect(data).toEqual(['hello'])
    })

    it('maps a server exit frame to status "closed" and delivers no data', async (): Promise<void> => {
        server = await startStubAttachServer(TEST_TOKEN)
        const data: string[] = []
        const statuses: string[] = []
        const handle = await runtime.attach(server.url, TEST_TOKEN, TERMINAL_ID)
        runtime.onData(handle, d => { data.push(d) })
        runtime.onStatus(handle, s => { statuses.push(s) })

        await waitFor(() => statuses.find(s => s === 'connected'))
        server.pushRaw(JSON.stringify({type: 'exit', code: 0}))
        await waitFor(() => statuses.find(s => s === 'closed'))
        expect(data).toEqual([])
    })

    it('wraps a write as {type:"data",payload} on the wire', async (): Promise<void> => {
        server = await startStubAttachServer(TEST_TOKEN)
        const statuses: string[] = []
        const handle = await runtime.attach(server.url, TEST_TOKEN, TERMINAL_ID)
        runtime.onStatus(handle, s => { statuses.push(s) })

        await waitFor(() => statuses.find(s => s === 'connected'))
        expect(runtime.write(handle, 'q')).toBe(true)
        expect(await server.nextFrame()).toEqual({type: 'data', payload: 'q'})
    })

    it('serializes resize as {type:"resize",cols,rows} on the wire', async (): Promise<void> => {
        server = await startStubAttachServer(TEST_TOKEN)
        const statuses: string[] = []
        const handle = await runtime.attach(server.url, TEST_TOKEN, TERMINAL_ID)
        runtime.onStatus(handle, s => { statuses.push(s) })

        await waitFor(() => statuses.find(s => s === 'connected'))
        expect(runtime.resize(handle, 101, 33)).toBe(true)
        expect(await server.nextFrame()).toEqual({type: 'resize', cols: 101, rows: 33})
    })

    it('serializes scroll as {type:"scroll",direction,lines} on the wire', async (): Promise<void> => {
        server = await startStubAttachServer(TEST_TOKEN)
        const statuses: string[] = []
        const handle = await runtime.attach(server.url, TEST_TOKEN, TERMINAL_ID)
        runtime.onStatus(handle, s => { statuses.push(s) })

        await waitFor(() => statuses.find(s => s === 'connected'))
        expect(runtime.scroll(handle, 'up', 5)).toBe(true)
        expect(await server.nextFrame()).toEqual({type: 'scroll', direction: 'up', lines: 5})
    })

    it('round-trips: a write echoed by the server reaches onData', async (): Promise<void> => {
        server = await startStubAttachServer(TEST_TOKEN)
        const data: string[] = []
        const statuses: string[] = []
        const handle = await runtime.attach(server.url, TEST_TOKEN, TERMINAL_ID)
        runtime.onData(handle, d => { data.push(d) })
        runtime.onStatus(handle, s => { statuses.push(s) })

        await waitFor(() => statuses.find(s => s === 'connected'))
        runtime.write(handle, 'ping')
        const frame = await server.nextFrame() as {payload: string}
        server.pushRaw(JSON.stringify({type: 'data', payload: `echo:${frame.payload}`}))
        await waitFor(() => data[0])
        expect(data).toEqual(['echo:ping'])
    })

    it('initial-paint race: an early frame and the "connected" status are not lost', async (): Promise<void> => {
        // Server pushes a data frame the instant the connection opens — before the
        // client's onopen. With attach resolving synchronously, the consumer
        // registers its listeners before any frame flows, so both the early repaint
        // and the 'connected' status land in populated listener sets.
        server = await startStubAttachServer(TEST_TOKEN, 'repaint')
        const data: string[] = []
        const statuses: string[] = []
        const handle = await runtime.attach(server.url, TEST_TOKEN, TERMINAL_ID)
        runtime.onData(handle, d => { data.push(d) })
        runtime.onStatus(handle, s => { statuses.push(s) })

        await waitFor(() => data.find(d => d === 'repaint'))
        await waitFor(() => statuses.find(s => s === 'connected'))
        expect(data).toContain('repaint')
        expect(statuses).toContain('connected')
    })
})
