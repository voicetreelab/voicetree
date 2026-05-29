/**
 * Main-process IPC bridge for the VTD /terminals/:id/attach stream
 * (Phase 0 / BF-368).
 *
 * Owns a `Map<handleId, VtTerminalAttachClient>`. Each `terminal:attach`
 * IPC invoke creates a fresh client, returns an opaque handle id, and
 * forwards every upstream `data`/`status` frame to the renderer via
 * `webContents.send('terminal:data' | 'terminal:status', handle, payload)`.
 *
 * Handle ids are opaque (crypto.randomUUID) — not raw terminal ids — so
 * renderer-side IPC routing never depends on terminal identity.
 *
 * Cleanup: returned closure disposes all clients and removes IPC handlers
 * on project switch / app shutdown.
 */
import {randomUUID} from 'node:crypto'
import {ipcMain, type BrowserWindow} from 'electron'
import type {RelayConnectionStatus} from './vtTerminalAttachTypes'
import {createVtTerminalAttachClient, type VtTerminalAttachClient} from './vtTerminalAttachClient'

const DATA_CHANNEL: string = 'terminal:data'
const STATUS_CHANNEL: string = 'terminal:status'
const ATTACH_INVOKE: string = 'terminal:attach'
const WRITE_INVOKE: string = 'terminal:write'
const RESIZE_INVOKE: string = 'terminal:resize'
const SCROLL_INVOKE: string = 'terminal:scroll'
const DETACH_INVOKE: string = 'terminal:detach'

export interface VtTerminalAttachBridgeDeps {
    readonly getMainWindow: () => BrowserWindow | null
    readonly getDaemonUrl: () => Promise<string>
    readonly getAuthToken: () => Promise<string>
    readonly setTimeoutImpl?: typeof setTimeout
    readonly clearTimeoutImpl?: typeof clearTimeout
    /** Test-only: override the opaque handle id generator for determinism. */
    readonly createHandleId?: () => string
}

export function installVtTerminalAttachBridge(deps: VtTerminalAttachBridgeDeps): () => void {
    const clients: Map<string, VtTerminalAttachClient> = new Map()
    const createHandleId: () => string = deps.createHandleId ?? randomUUID

    const sendToRenderer = (channel: string, handle: string, payload: unknown): void => {
        const window: BrowserWindow | null = deps.getMainWindow()
        if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return
        window.webContents.send(channel, handle, payload)
    }

    ipcMain.handle(ATTACH_INVOKE, (_event, terminalId: string): string => {
        const handle: string = createHandleId()
        const client: VtTerminalAttachClient = createVtTerminalAttachClient({
            terminalId,
            getDaemonUrl: deps.getDaemonUrl,
            getAuthToken: deps.getAuthToken,
            onData: (payload: string): void => sendToRenderer(DATA_CHANNEL, handle, payload),
            onStatus: (status: RelayConnectionStatus): void => sendToRenderer(STATUS_CHANNEL, handle, status),
            setTimeoutImpl: deps.setTimeoutImpl,
            clearTimeoutImpl: deps.clearTimeoutImpl,
        })
        clients.set(handle, client)
        return handle
    })

    ipcMain.handle(WRITE_INVOKE, (_event, handle: string, data: string): boolean => {
        return clients.get(handle)?.sendData(data) ?? false
    })

    ipcMain.handle(RESIZE_INVOKE, (_event, handle: string, cols: number, rows: number): boolean => {
        return clients.get(handle)?.sendResize(cols, rows) ?? false
    })

    ipcMain.handle(SCROLL_INVOKE, (_event, handle: string, direction: 'up' | 'down', lines: number): boolean => {
        return clients.get(handle)?.sendScroll(direction, lines) ?? false
    })

    // Idempotent: a second detach on an already-released handle is a no-op
    // (TerminalVanilla.dispose() can fire twice on rapid unmount — see BF-368
    // gotcha "Reconnect on terminal dispose race").
    ipcMain.handle(DETACH_INVOKE, (_event, handle: string): boolean => {
        const client: VtTerminalAttachClient | undefined = clients.get(handle)
        if (!client) return false
        clients.delete(handle)
        client.dispose()
        return true
    })

    return (): void => {
        ipcMain.removeHandler(ATTACH_INVOKE)
        ipcMain.removeHandler(WRITE_INVOKE)
        ipcMain.removeHandler(RESIZE_INVOKE)
        ipcMain.removeHandler(SCROLL_INVOKE)
        ipcMain.removeHandler(DETACH_INVOKE)
        for (const client of clients.values()) client.dispose()
        clients.clear()
    }
}
