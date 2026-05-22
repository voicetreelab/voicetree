/**
 * Renderer-side production wire-up for the /events WebSocket subscription
 * (§8.1: client in renderer directly).
 *
 * Browser WebSocket cannot set the Authorization header §4.3 names, so per
 * Gus's 2026-05-22 resolution the bearer token is presented as the
 * `vt-bearer` subprotocol value. Server reads `Sec-WebSocket-Protocol` on
 * upgrade. HTTP routes (/rpc, /hook/:source) keep the Authorization header.
 */
import {
    createEventSubscription,
    type ConnectionState,
    type EventFrame,
    type EventSubscriptionHandle,
    type GapFrame,
    type Topic,
    type WebSocketLike,
} from './eventSubscription'

const BEARER_SUBPROTOCOL = 'vt-bearer' as const

export interface VaultStateSubscriptionCallbacks {
    readonly onEvent: (frame: EventFrame) => void
    readonly onResnapshot: (topic: Topic) => void
    readonly onConnectionState?: (state: ConnectionState) => void
}

function browserSubprotocolWebSocket(eventsUrl: string, token: string): WebSocketLike {
    const ws: WebSocket = new WebSocket(eventsUrl, [BEARER_SUBPROTOCOL, token])
    const adapter: WebSocketLike = {
        get readyState(): number { return ws.readyState },
        send: (data: string): void => ws.send(data),
        close: (code?: number, reason?: string): void => ws.close(code, reason),
        onopen: null, onmessage: null, onclose: null, onerror: null,
    }
    ws.addEventListener('open', (): void => { adapter.onopen?.() })
    ws.addEventListener('message', (e: MessageEvent): void => { adapter.onmessage?.({ data: e.data }) })
    ws.addEventListener('close', (e: CloseEvent): void => { adapter.onclose?.({ code: e.code, reason: e.reason }) })
    ws.addEventListener('error', (e: Event): void => { adapter.onerror?.(e) })
    return adapter
}

export function connectVaultStateSubscription(
    topics: readonly Topic[],
    callbacks: VaultStateSubscriptionCallbacks,
): EventSubscriptionHandle {
    return createEventSubscription({
        getDaemonUrl: async (): Promise<string> => {
            const api = window.electronAPI
            if (!api) throw new Error('electronAPI unavailable')
            return api.main.getDaemonUrl()
        },
        getAuthToken: async (): Promise<string> => {
            const api = window.electronAPI
            if (!api) throw new Error('electronAPI unavailable')
            return api.main.getAuthToken()
        },
        topics,
        onEvent: callbacks.onEvent,
        onGap: (frame: GapFrame): void => callbacks.onResnapshot(frame.topic),
        onConnectionState: callbacks.onConnectionState,
        webSocketFactory: browserSubprotocolWebSocket,
    })
}
