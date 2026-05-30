/**
 * Black-box tests for installVtTerminalAttachBridge.
 *
 * - `electron.ipcMain` is faked at the module boundary (recorded handlers
 *   can be invoked synchronously to simulate renderer→main IPC).
 * - `webContents.send` calls land in a sink array (observable side effect
 *   for outbound frames).
 * - The upstream VTD `/terminals/:id/attach` WebSocket is a REAL Node `ws`
 *   server so we exercise the production wire-shape end-to-end.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createServer, type IncomingMessage, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import type {Duplex} from 'node:stream'
import {WebSocket, WebSocketServer} from 'ws'

interface IpcCall { readonly channel: string; readonly handle: string; readonly payload: unknown }
const ipcMainHandlers: Map<string, (...args: unknown[]) => unknown> = new Map()

vi.mock('electron', () => ({
    ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown): void => {
            ipcMainHandlers.set(channel, handler)
        },
        removeHandler: (channel: string): void => { ipcMainHandlers.delete(channel) },
    },
}))

import {installVtTerminalAttachBridge, type VtTerminalAttachBridgeHandle} from './vtTerminalAttachBridge'

const TEST_TOKEN: string = 'cafef00d'
const TERMINAL_ID: string = 't-12345'

interface SinkWindow {
    isDestroyed: () => boolean
    webContents: {
        isDestroyed: () => boolean
        send: (channel: string, handle: string, payload: unknown) => void
    }
}

function makeSink(): {window: SinkWindow; calls: IpcCall[]} {
    const calls: IpcCall[] = []
    return {
        window: {
            isDestroyed: () => false,
            webContents: {
                isDestroyed: () => false,
                send: (channel: string, handle: string, payload: unknown): void => {
                    calls.push({channel, handle, payload})
                },
            },
        },
        calls,
    }
}

interface AttachServer {
    readonly url: string
    readonly waitForClient: () => Promise<void>
    readonly pushData: (payload: string) => void
    readonly nextFrame: () => Promise<unknown>
    readonly activeCloseCount: () => number
    readonly close: () => Promise<void>
}

async function startStubAttachServer(token: string): Promise<AttachServer> {
    const httpServer: Server = createServer((_req, res) => { res.writeHead(404); res.end() })
    const wss: WebSocketServer = new WebSocketServer({noServer: true})
    let activeWs: WebSocket | null = null
    let closedCount: number = 0
    const clientResolvers: Array<() => void> = []
    const frameResolvers: Array<(v: unknown) => void> = []
    const frameBuffer: unknown[] = []

    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const auth = (req.headers.authorization ?? '') as string
        if (auth !== `Bearer ${token}`) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return
        }
        wss.handleUpgrade(req, socket, head, (ws: WebSocket): void => {
            activeWs = ws
            ws.on('close', () => { closedCount += 1; if (activeWs === ws) activeWs = null })
            ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]): void => {
                const text: string = Buffer.isBuffer(raw) ? raw.toString('utf-8')
                    : Array.isArray(raw) ? Buffer.concat(raw).toString('utf-8')
                    : Buffer.from(raw as ArrayBuffer).toString('utf-8')
                let parsed: unknown = null
                try { parsed = JSON.parse(text) } catch { /* leave null */ }
                const r = frameResolvers.shift()
                if (r) r(parsed); else frameBuffer.push(parsed)
            })
            clientResolvers.shift()?.()
        })
    })

    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve))
    const port: number = (httpServer.address() as AddressInfo).port

    return {
        url: `http://127.0.0.1:${port}`,
        waitForClient: (): Promise<void> => new Promise(resolve => clientResolvers.push(resolve)),
        pushData: (payload: string): void => {
            if (activeWs && activeWs.readyState === WebSocket.OPEN) {
                activeWs.send(JSON.stringify({type: 'data', payload}))
            }
        },
        nextFrame: (): Promise<unknown> => {
            const buffered = frameBuffer.shift()
            if (buffered !== undefined) return Promise.resolve(buffered)
            return new Promise(resolve => frameResolvers.push(resolve))
        },
        activeCloseCount: (): number => closedCount,
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

async function waitForConnected(calls: ReadonlyArray<IpcCall>, handle: string): Promise<void> {
    await waitFor((): true | undefined =>
        calls.some(c => c.channel === 'terminal:status' && c.handle === handle && c.payload === 'connected') ? true : undefined,
    )
}

describe('installVtTerminalAttachBridge', (): void => {
    let server: AttachServer
    let bridge: VtTerminalAttachBridgeHandle | null = null
    let handleCounter: number = 0

    beforeEach(async (): Promise<void> => {
        ipcMainHandlers.clear()
        server = await startStubAttachServer(TEST_TOKEN)
        handleCounter = 0
    })

    afterEach(async (): Promise<void> => {
        bridge?.teardown()
        bridge = null
        ipcMainHandlers.clear()
        await server.close()
    })

    function install(window: SinkWindow): void {
        bridge = installVtTerminalAttachBridge({
            getMainWindow: () => window as unknown as Electron.BrowserWindow,
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            createHandleId: () => `h-${++handleCounter}`,
        })
    }

    it('terminal:attach returns a handle id; subsequent terminal:write reaches the server', async (): Promise<void> => {
        const {window, calls} = makeSink()
        install(window)

        const attach = ipcMainHandlers.get('terminal:attach')
        expect(attach).toBeTruthy()
        const handle = await attach!({} as never, TERMINAL_ID)
        expect(handle).toBe('h-1')

        await server.waitForClient()
        await waitForConnected(calls, 'h-1')

        const write = ipcMainHandlers.get('terminal:write')
        expect(write).toBeTruthy()
        const ok = await write!({} as never, 'h-1', 'hello')
        expect(ok).toBe(true)

        const frame = await server.nextFrame()
        expect(frame).toEqual({type: 'data', payload: 'hello'})
    })

    it('upstream data frame triggers webContents.send(terminal:data, handle, payload)', async (): Promise<void> => {
        const {window, calls} = makeSink()
        install(window)
        const attach = ipcMainHandlers.get('terminal:attach')!
        const handle = (await attach({} as never, TERMINAL_ID)) as string
        await server.waitForClient()

        server.pushData('out-1')

        const got = await waitFor(() => calls.find(c => c.channel === 'terminal:data' && c.payload === 'out-1'))
        expect(got.handle).toBe(handle)
    })

    it('terminal:detach disposes the upstream WS; further write is no-op (returns false)', async (): Promise<void> => {
        const {window, calls} = makeSink()
        install(window)
        const attach = ipcMainHandlers.get('terminal:attach')!
        const detach = ipcMainHandlers.get('terminal:detach')!
        const write = ipcMainHandlers.get('terminal:write')!
        const handle = (await attach({} as never, TERMINAL_ID)) as string
        await server.waitForClient()
        await waitForConnected(calls, handle)

        // Confirm we can write before detach.
        const okBefore = await write({} as never, handle, 'pre-detach')
        expect(okBefore).toBe(true)
        await server.nextFrame()

        const detached = await detach({} as never, handle)
        expect(detached).toBe(true)

        await waitFor((): true | undefined => server.activeCloseCount() >= 1 ? true : undefined)

        const postWrite = await write({} as never, handle, 'should-not-arrive')
        expect(postWrite).toBe(false)
    })

    it('terminal:resize forwards to the upstream as {type:"resize",cols,rows}', async (): Promise<void> => {
        const {window, calls} = makeSink()
        install(window)
        const attach = ipcMainHandlers.get('terminal:attach')!
        const resize = ipcMainHandlers.get('terminal:resize')!
        const handle = (await attach({} as never, TERMINAL_ID)) as string
        await server.waitForClient()
        await waitForConnected(calls, handle)

        const ok = await resize({} as never, handle, 120, 40)
        expect(ok).toBe(true)

        const frame = await server.nextFrame()
        expect(frame).toEqual({type: 'resize', cols: 120, rows: 40})
    })

    it('teardown removes all ipcMain handlers', (): void => {
        const {window} = makeSink()
        install(window)
        for (const ch of ['terminal:attach', 'terminal:write', 'terminal:resize', 'terminal:detach']) {
            expect(ipcMainHandlers.has(ch)).toBe(true)
        }
        bridge?.teardown()
        bridge = null
        for (const ch of ['terminal:attach', 'terminal:write', 'terminal:resize', 'terminal:detach']) {
            expect(ipcMainHandlers.has(ch)).toBe(false)
        }
    })

    it('disposeAllClients disposes live clients but keeps the ipcMain handlers (renderer-reload path)', async (): Promise<void> => {
        const {window, calls} = makeSink()
        install(window)
        const attach = ipcMainHandlers.get('terminal:attach')!
        const write = ipcMainHandlers.get('terminal:write')!
        const handle = (await attach({} as never, TERMINAL_ID)) as string
        await server.waitForClient()
        await waitForConnected(calls, handle)

        // A reload orphans the renderer's handle; disposeAllClients drops the
        // upstream client so a stale write becomes a no-op...
        bridge!.disposeAllClients()
        await waitFor((): true | undefined => server.activeCloseCount() >= 1 ? true : undefined)
        expect(await write({} as never, handle, 'orphaned')).toBe(false)

        // ...but the handlers stay registered so the fresh renderer re-attaches.
        for (const ch of ['terminal:attach', 'terminal:write', 'terminal:resize', 'terminal:detach']) {
            expect(ipcMainHandlers.has(ch)).toBe(true)
        }
        const handle2 = (await attach({} as never, TERMINAL_ID)) as string
        await server.waitForClient()
        await waitForConnected(calls, handle2)
        expect(await write({} as never, handle2, 'fresh')).toBe(true)
    })
})
