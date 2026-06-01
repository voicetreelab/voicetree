// VTD HTTP JSON-RPC + fetch-based SSE client for the browser.
// Uses Authorization: Bearer <token> for all HTTP requests.
// WS upgrades use the vt-bearer subprotocol (browser can't set arbitrary WS headers).

import type {ConnectionState, EventFrame, GapFrame} from '@vt/vt-daemon/transport/eventTypes'
import type {VTSettings} from '@vt/graph-model/settings'

async function rpcCall<T>(
    vtdUrl: string,
    token: string,
    method: string,
    params: Record<string, unknown>,
): Promise<T> {
    const res = await fetch(`${vtdUrl}/rpc`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({jsonrpc: '2.0', method, params, id: Date.now()}),
    })
    if (res.status === 401) throw new Error(`VTD auth failed (401)`)
    if (!res.ok) throw new Error(`VTD /rpc ${method} → ${res.status}`)
    const body = await res.json() as {result?: T; error?: {message: string}}
    if ('error' in body && body.error) throw new Error(`VTD RPC ${method} error: ${body.error.message}`)
    return body.result as T
}

export function callVtdRpc<T>(
    vtdUrl: string,
    token: string,
    method: string,
    params: Record<string, unknown>,
): Promise<T> {
    return rpcCall<T>(vtdUrl, token, method, params)
}

/**
 * Fetch the resolved VTSettings from VTD's authenticated GET /settings route.
 * Gives the browser-mode adapter the same settings the Electron renderer gets
 * over IPC — notably `agents`, which drives the editor horizontal menu.
 */
export async function vtdGetSettings(vtdUrl: string, token: string): Promise<VTSettings> {
    const res = await fetch(`${vtdUrl}/settings`, {
        headers: {'Authorization': `Bearer ${token}`},
    })
    if (res.status === 401) throw new Error('VTD auth failed (401)')
    if (!res.ok) throw new Error(`VTD /settings → ${res.status}`)
    return res.json() as Promise<VTSettings>
}

/** Subscribe to VTD /events WebSocket. Returns a cleanup function. */
export function vtdSubscribeEvents(
    vtdUrl: string,
    token: string,
    onFrame: (frame: EventFrame | GapFrame) => void,
    onConnectionState: (state: ConnectionState) => void,
): () => void {
    const wsUrl = vtdUrl.replace(/^http/, 'ws') + '/events'
    let ws: WebSocket | null = null
    let disposed = false

    function connect(): void {
        if (disposed) return
        onConnectionState({kind: 'connecting', attempt: 1})
        ws = new WebSocket(wsUrl, ['vt-bearer', token])

        ws.onopen = (): void => onConnectionState({kind: 'connected'})
        ws.onmessage = (ev: MessageEvent): void => {
            try {
                const frame = JSON.parse(ev.data as string) as EventFrame | GapFrame
                onFrame(frame)
            } catch {
                // malformed frame — ignore
            }
        }
        ws.onerror = (): void => onConnectionState({kind: 'closed'})
        ws.onclose = (): void => {
            onConnectionState({kind: 'closed'})
            if (!disposed) setTimeout(connect, 2000)
        }
    }

    connect()
    return (): void => {
        disposed = true
        ws?.close()
        ws = null
    }
}

/** Subscribe to VTD /sessions/:sessionId/terminal-registry SSE with auth via fetch. */
export function vtdSubscribeTerminalRegistry(
    vtdUrl: string,
    token: string,
    sessionId: string,
    onData: (data: string) => void,
    onError: (err: unknown) => void,
): () => void {
    const abortController = new AbortController()
    void (async () => {
        try {
            const res = await fetch(
                `${vtdUrl}/sessions/${sessionId}/terminal-registry`,
                {
                    headers: {'Authorization': `Bearer ${token}`},
                    signal: abortController.signal,
                },
            )
            if (!res.ok || !res.body) throw new Error(`terminal-registry SSE open failed: ${res.status}`)
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buf = ''
            while (true) {
                const {done, value} = await reader.read()
                if (done) break
                buf += decoder.decode(value, {stream: true})
                const lines = buf.split('\n')
                buf = lines.pop() ?? ''
                for (const line of lines) {
                    if (line.startsWith('data: ')) onData(line.slice(6))
                }
            }
        } catch (err) {
            if ((err as {name?: string}).name !== 'AbortError') onError(err)
        }
    })()
    return () => abortController.abort()
}
