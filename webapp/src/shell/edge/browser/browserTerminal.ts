// Browser terminal transport: DOM WebSocket to VTD /terminals/:id/attach
// with vt-bearer subprotocol auth. The relay wire format lives in the shared
// runtime-neutral codec (@/core/terminal/relayEnvelope); this module owns only
// the DOM WebSocket transport and the handle/listener bookkeeping.

import type {RelayConnectionStatus} from '@/core/terminal/relayConnectionStatus'
import {
    decodeWsData,
    parseRelayServerMessage,
    serializeRelayClientMessage,
} from '@/core/terminal/relayEnvelope'

type DataListener = (data: string) => void
type StatusListener = (status: RelayConnectionStatus) => void

interface TerminalHandle {
    readonly ws: WebSocket
    readonly dataListeners: Set<DataListener>
    readonly statusListeners: Set<StatusListener>
}

export interface BrowserTerminalRuntime {
    readonly attach: (vtdUrl: string, token: string, terminalId: string) => Promise<string>
    readonly onData: (handleId: string, listener: DataListener) => () => void
    readonly onStatus: (handleId: string, listener: StatusListener) => () => void
    readonly write: (handleId: string, data: string) => boolean
    readonly resize: (handleId: string, cols: number, rows: number) => boolean
    readonly scroll: (handleId: string, direction: 'up' | 'down', lines: number) => boolean
    readonly detach: (handleId: string) => boolean
}

function buildAttachUrl(vtdUrl: string, terminalId: string): string {
    const base = vtdUrl.replace(/^http/, 'ws')
    return `${base}/terminals/${encodeURIComponent(terminalId)}/attach?cols=220&rows=50`
}

function newHandleId(): string {
    return `browser-term-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createBrowserTerminalRuntime(): BrowserTerminalRuntime {
    const handles = new Map<string, TerminalHandle>()

    function attach(vtdUrl: string, token: string, terminalId: string): Promise<string> {
        const handleId = newHandleId()
        const url = buildAttachUrl(vtdUrl, terminalId)
        const ws = new WebSocket(url, ['vt-bearer', token])
        const handle: TerminalHandle = {ws, dataListeners: new Set(), statusListeners: new Set()}
        handles.set(handleId, handle)

        ws.binaryType = 'arraybuffer'
        ws.onopen = (): void => {
            for (const l of handle.statusListeners) l('connected')
        }
        ws.onerror = (): void => {
            for (const l of handle.statusListeners) l('error')
        }
        ws.onclose = (): void => {
            for (const l of handle.statusListeners) l('closed')
            handles.delete(handleId)
        }
        ws.onmessage = (ev: MessageEvent): void => {
            const msg = parseRelayServerMessage(decodeWsData(ev.data))
            if (!msg) return
            if (msg.type === 'data') {
                for (const l of handle.dataListeners) l(msg.payload)
            } else if (msg.type === 'exit') {
                for (const l of handle.statusListeners) l('closed')
            }
        }

        // Resolve synchronously with the handle so the consumer registers its
        // data/status listeners before the socket opens — mirroring the Electron
        // IPC bridge, which returns the handle before its upstream WS connects.
        // The initial 'connected' frame and tmux repaint burst therefore land in
        // a populated listener set; no buffer is needed. Connection failures are
        // surfaced via the 'error'/'closed' status, so attach never rejects.
        return Promise.resolve(handleId)
    }

    function onData(handleId: string, listener: DataListener): () => void {
        const h = handles.get(handleId)
        if (!h) return () => {}
        h.dataListeners.add(listener)
        return () => h.dataListeners.delete(listener)
    }

    function onStatus(handleId: string, listener: StatusListener): () => void {
        const h = handles.get(handleId)
        if (!h) return () => {}
        h.statusListeners.add(listener)
        return () => h.statusListeners.delete(listener)
    }

    function write(handleId: string, data: string): boolean {
        const h = handles.get(handleId)
        if (!h || h.ws.readyState !== WebSocket.OPEN) return false
        h.ws.send(serializeRelayClientMessage({type: 'data', payload: data}))
        return true
    }

    function resize(handleId: string, cols: number, rows: number): boolean {
        const h = handles.get(handleId)
        if (!h || h.ws.readyState !== WebSocket.OPEN) return false
        h.ws.send(serializeRelayClientMessage({type: 'resize', cols, rows}))
        return true
    }

    function scroll(handleId: string, direction: 'up' | 'down', lines: number): boolean {
        const h = handles.get(handleId)
        if (!h || h.ws.readyState !== WebSocket.OPEN) return false
        h.ws.send(serializeRelayClientMessage({type: 'scroll', direction, lines}))
        return true
    }

    function detach(handleId: string): boolean {
        const h = handles.get(handleId)
        if (!h) return false
        h.ws.close()
        handles.delete(handleId)
        return true
    }

    return {attach, onData, onStatus, write, resize, scroll, detach}
}
