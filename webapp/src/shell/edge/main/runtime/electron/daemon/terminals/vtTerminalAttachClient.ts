/**
 * Main-process /terminals/:id/attach WebSocket client (Phase 0 / BF-368).
 *
 * Owns one upstream WS per active terminal handle, bridging tmux PTY I/O
 * onto Main-side callbacks. Native `Authorization: Bearer` header (Node `ws`
 * module) — no `vt-bearer` subprotocol workaround. The renderer never sees
 * the bearer token.
 *
 * JSON wire frames (preserved verbatim from the deleted renderer-side
 * TerminalRelayClient):
 *   server→client: { type: 'data', payload }
 *   server→client: { type: 'exit' }
 *   client→server: { type: 'data', payload }
 *   client→server: { type: 'resize', cols, rows }
 *
 * Reconnect: exponential doubling 200ms → 5s ceiling.
 */
import {WebSocket} from 'ws'
import type {RelayConnectionStatus} from './vtTerminalAttachTypes'

const INITIAL_RECONNECT_DELAY_MS: number = 200
const MAX_RECONNECT_DELAY_MS: number = 5000

export interface VtTerminalAttachClientDeps {
    readonly terminalId: string
    readonly getDaemonUrl: () => Promise<string>
    readonly getAuthToken: () => Promise<string>
    readonly onData: (payload: string) => void
    readonly onStatus: (status: RelayConnectionStatus) => void
    readonly setTimeoutImpl?: typeof setTimeout
    readonly clearTimeoutImpl?: typeof clearTimeout
}

export interface VtTerminalAttachClient {
    readonly sendData: (data: string) => boolean
    readonly sendResize: (cols: number, rows: number) => boolean
    readonly dispose: () => void
}

export function attachUrlFromDaemonUrl(daemonUrl: string, terminalId: string): string {
    const url: URL = new URL(`/terminals/${encodeURIComponent(terminalId)}/attach`, daemonUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
}

function parseRelayMessage(raw: string): {readonly type: string; readonly payload?: string; readonly code?: number} | null {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return null }
    if (!parsed || typeof parsed !== 'object') return null
    const msg = parsed as {readonly type?: unknown; readonly payload?: unknown; readonly code?: unknown}
    if (typeof msg.type !== 'string') return null
    return {
        type: msg.type,
        payload: typeof msg.payload === 'string' ? msg.payload : undefined,
        code: typeof msg.code === 'number' ? msg.code : undefined,
    }
}

function decodeMessage(data: unknown): string {
    if (typeof data === 'string') return data
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('utf-8')
    if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf-8')
    return ''
}

export function createVtTerminalAttachClient(deps: VtTerminalAttachClientDeps): VtTerminalAttachClient {
    const setTimeoutFn: typeof setTimeout = deps.setTimeoutImpl ?? globalThis.setTimeout
    const clearTimeoutFn: typeof clearTimeout = deps.clearTimeoutImpl ?? globalThis.clearTimeout

    let socket: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectDelayMs: number = INITIAL_RECONNECT_DELAY_MS
    let disposed: boolean = false

    function clearReconnectTimer(): void {
        if (reconnectTimer === null) return
        clearTimeoutFn(reconnectTimer)
        reconnectTimer = null
    }

    function scheduleReconnect(): void {
        if (disposed) return
        deps.onStatus('reconnecting')
        const delayMs: number = reconnectDelayMs
        reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS)
        clearReconnectTimer()
        reconnectTimer = setTimeoutFn((): void => {
            reconnectTimer = null
            void connect()
        }, delayMs)
    }

    async function connect(): Promise<void> {
        if (disposed) return
        clearReconnectTimer()
        deps.onStatus(socket ? 'reconnecting' : 'connecting')

        let daemonUrl: string
        let token: string
        try {
            daemonUrl = await deps.getDaemonUrl()
            token = await deps.getAuthToken()
        } catch {
            scheduleReconnect()
            return
        }
        if (disposed) return

        let ws: WebSocket
        try {
            ws = new WebSocket(attachUrlFromDaemonUrl(daemonUrl, deps.terminalId), {
                headers: {Authorization: `Bearer ${token}`},
            })
        } catch {
            scheduleReconnect()
            return
        }
        socket = ws

        ws.on('open', (): void => {
            if (socket !== ws || disposed) return
            reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS
            deps.onStatus('connected')
        })

        ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]): void => {
            if (socket !== ws || disposed) return
            const text: string = decodeMessage(raw)
            if (!text) return
            const msg = parseRelayMessage(text)
            if (!msg) return
            if (msg.type === 'data' && msg.payload !== undefined) {
                deps.onData(msg.payload)
            } else if (msg.type === 'exit') {
                deps.onStatus('closed')
            }
        })

        ws.on('error', (): void => {
            if (socket !== ws || disposed) return
            deps.onStatus('error')
            // 'close' follows; reconnect is scheduled there.
        })

        ws.on('close', (): void => {
            if (socket !== ws || disposed) return
            socket = null
            scheduleReconnect()
        })
    }

    function send(message: object): boolean {
        if (!socket || socket.readyState !== WebSocket.OPEN) return false
        try {
            socket.send(JSON.stringify(message))
            return true
        } catch {
            return false
        }
    }

    void connect()

    return {
        sendData: (payload: string): boolean => send({type: 'data', payload}),
        sendResize: (cols: number, rows: number): boolean => send({type: 'resize', cols, rows}),
        dispose: (): void => {
            disposed = true
            clearReconnectTimer()
            const ws: WebSocket | null = socket
            socket = null
            try { ws?.close(1000, 'client disposed') } catch { /* best-effort */ }
        },
    }
}
