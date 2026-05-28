/**
 * Black-box tests for installVtDaemonEventsBridge.
 *
 * - electron `ipcMain` is faked at the module boundary (it's the Electron
 *   IPC layer, not an internal collaborator — see CLAUDE.md: "mock at the
 *   API boundary, not internal collaborators").
 * - `webContents.send` is the observable side effect for outbound frames;
 *   we collect calls into an array and assert on its contents.
 * - The upstream `/events` WebSocket is a REAL Node `ws` server so we
 *   exercise the production wire-shape end-to-end.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createServer, type IncomingMessage, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import type {Duplex} from 'node:stream'
import {WebSocket, WebSocketServer} from 'ws'
import type {EventFrame} from '@vt/vt-daemon/transport/eventTypes'

interface IpcCall { readonly channel: string; readonly payload: unknown }
const ipcMainHandlers: Map<string, (...args: unknown[]) => unknown> = new Map()

vi.mock('electron', () => ({
    ipcMain: {
        handle: (channel: string, handler: (...args: unknown[]) => unknown): void => {
            ipcMainHandlers.set(channel, handler)
        },
        removeHandler: (channel: string): void => { ipcMainHandlers.delete(channel) },
    },
}))

import {installVtDaemonEventsBridge} from './vtDaemonEventsBridge'

const TEST_TOKEN: string = 'cafef00d'

interface SinkWindow {
    isDestroyed: () => boolean
    webContents: {
        isDestroyed: () => boolean
        send: (channel: string, payload: unknown) => void
    }
}

function makeSink(): {window: SinkWindow; calls: IpcCall[]} {
    const calls: IpcCall[] = []
    const window: SinkWindow = {
        isDestroyed: () => false,
        webContents: {
            isDestroyed: () => false,
            send: (channel: string, payload: unknown): void => { calls.push({channel, payload}) },
        },
    }
    return {window, calls}
}

interface StubServerHandle {
    readonly url: string
    readonly publish: (frame: EventFrame) => void
    readonly waitForClient: () => Promise<void>
    readonly close: () => Promise<void>
}

async function startStubEventsServer(token: string): Promise<StubServerHandle> {
    const httpServer: Server = createServer((_req, res) => { res.writeHead(404); res.end() })
    const wss: WebSocketServer = new WebSocketServer({noServer: true})
    let activeWs: WebSocket | null = null
    const clientResolvers: Array<() => void> = []

    httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
        const auth = (req.headers.authorization ?? '') as string
        if (auth !== `Bearer ${token}`) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return
        }
        wss.handleUpgrade(req, socket, head, (ws: WebSocket): void => {
            activeWs = ws
            ws.on('close', () => { if (activeWs === ws) activeWs = null })
            // Drain client subscribe frames silently.
            ws.on('message', () => {})
            clientResolvers.shift()?.()
        })
    })

    await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve))
    const port: number = (httpServer.address() as AddressInfo).port

    return {
        url: `http://127.0.0.1:${port}`,
        publish: (frame: EventFrame): void => {
            if (activeWs && activeWs.readyState === WebSocket.OPEN) {
                activeWs.send(JSON.stringify(frame))
            }
        },
        waitForClient: (): Promise<void> => new Promise(resolve => clientResolvers.push(resolve)),
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

describe('installVtDaemonEventsBridge', (): void => {
    let server: StubServerHandle
    let teardown: (() => void) | null = null

    beforeEach(async (): Promise<void> => {
        ipcMainHandlers.clear()
        server = await startStubEventsServer(TEST_TOKEN)
    })

    afterEach(async (): Promise<void> => {
        teardown?.()
        teardown = null
        ipcMainHandlers.clear()
        await server.close()
    })

    it('forwards upstream event frames to webContents.send on vt:events', async (): Promise<void> => {
        const {window, calls} = makeSink()
        teardown = installVtDaemonEventsBridge({
            getMainWindow: () => window as unknown as Electron.BrowserWindow,
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            random: () => 0,
        })

        await server.waitForClient()
        const frame: EventFrame = {
            type: 'event', topic: 'agent-lifecycle', seq: 1, event: 'agent-spawned',
            data: {terminalId: 'T1', source: 'claude', at: 0},
        }
        server.publish(frame)

        const eventCall = await waitFor(() => calls.find(c => c.channel === 'vt:events'))
        expect(eventCall.payload).toEqual(frame)
    })

    it('forwards connection-state transitions to webContents.send on vt:events:connection', async (): Promise<void> => {
        const {window, calls} = makeSink()
        teardown = installVtDaemonEventsBridge({
            getMainWindow: () => window as unknown as Electron.BrowserWindow,
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            random: () => 0,
        })

        await waitFor((): true | undefined =>
            calls.some(c => c.channel === 'vt:events:connection') ? true : undefined,
        )
        const states = calls.filter(c => c.channel === 'vt:events:connection').map(c => c.payload as {kind: string})
        expect(states.some(s => s.kind === 'connecting')).toBe(true)
    })

    it('registers a vt:events:resnapshot ipcMain handler that resolves', async (): Promise<void> => {
        const {window} = makeSink()
        teardown = installVtDaemonEventsBridge({
            getMainWindow: () => window as unknown as Electron.BrowserWindow,
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            random: () => 0,
        })
        await server.waitForClient()

        const handler = ipcMainHandlers.get('vt:events:resnapshot')
        expect(handler).toBeTruthy()
        await expect(handler!({} as never, 'agent-lifecycle')).resolves.toBeUndefined()
    })

    it('teardown removes the vt:events:resnapshot ipcMain handler', async (): Promise<void> => {
        const {window} = makeSink()
        const t = installVtDaemonEventsBridge({
            getMainWindow: () => window as unknown as Electron.BrowserWindow,
            getDaemonUrl: () => Promise.resolve(server.url),
            getAuthToken: () => Promise.resolve(TEST_TOKEN),
            random: () => 0,
        })
        expect(ipcMainHandlers.has('vt:events:resnapshot')).toBe(true)
        t()
        expect(ipcMainHandlers.has('vt:events:resnapshot')).toBe(false)
    })
})
