// Browser terminal implementation: WS to VTD /terminals/:id/attach
// with vt-bearer subprotocol auth.

import type {RelayConnectionStatus} from '@/shell/edge/main/runtime/electron/daemon/terminals/vtTerminalAttachTypes'

type DataListener = (data: string) => void
type StatusListener = (status: RelayConnectionStatus) => void

interface TerminalHandle {
    readonly ws: WebSocket
    readonly dataListeners: Set<DataListener>
    readonly statusListeners: Set<StatusListener>
}

const handles = new Map<string, TerminalHandle>()

function buildAttachUrl(vtdUrl: string, terminalId: string): string {
    const base = vtdUrl.replace(/^http/, 'ws')
    return `${base}/terminals/${encodeURIComponent(terminalId)}/attach?cols=220&rows=50`
}

function newHandleId(): string {
    return `browser-term-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function attachBrowserTerminal(vtdUrl: string, token: string, terminalId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const handleId = newHandleId()
        const url = buildAttachUrl(vtdUrl, terminalId)
        const ws = new WebSocket(url, ['vt-bearer', token])
        const handle: TerminalHandle = {ws, dataListeners: new Set(), statusListeners: new Set()}
        handles.set(handleId, handle)

        ws.binaryType = 'arraybuffer'
        ws.onopen = (): void => {
            for (const l of handle.statusListeners) l('connected')
            resolve(handleId)
        }
        ws.onerror = (ev): void => {
            for (const l of handle.statusListeners) l('error')
            reject(new Error(`terminal attach WS error for ${terminalId}`))
            void ev
        }
        ws.onclose = (): void => {
            for (const l of handle.statusListeners) l('closed')
            handles.delete(handleId)
        }
        ws.onmessage = (ev: MessageEvent): void => {
            const text: string = typeof ev.data === 'string'
                ? ev.data
                : new TextDecoder().decode(ev.data as ArrayBuffer)
            for (const l of handle.dataListeners) l(text)
        }
    })
}

export function onBrowserTerminalData(handleId: string, listener: DataListener): () => void {
    const h = handles.get(handleId)
    if (!h) return () => {}
    h.dataListeners.add(listener)
    return () => h.dataListeners.delete(listener)
}

export function onBrowserTerminalStatus(handleId: string, listener: StatusListener): () => void {
    const h = handles.get(handleId)
    if (!h) return () => {}
    h.statusListeners.add(listener)
    return () => h.statusListeners.delete(listener)
}

export function writeTerminal(handleId: string, data: string): boolean {
    const h = handles.get(handleId)
    if (!h || h.ws.readyState !== WebSocket.OPEN) return false
    h.ws.send(data)
    return true
}

export function resizeTerminal(handleId: string, cols: number, rows: number): boolean {
    const h = handles.get(handleId)
    if (!h || h.ws.readyState !== WebSocket.OPEN) return false
    h.ws.send(JSON.stringify({type: 'resize', cols, rows}))
    return true
}

export function scrollTerminal(handleId: string, direction: 'up' | 'down', lines: number): boolean {
    const h = handles.get(handleId)
    if (!h || h.ws.readyState !== WebSocket.OPEN) return false
    h.ws.send(JSON.stringify({type: 'scroll', direction, lines}))
    return true
}

export function detachTerminal(handleId: string): boolean {
    const h = handles.get(handleId)
    if (!h) return false
    h.ws.close()
    handles.delete(handleId)
    return true
}
