/**
 * Renderer-side WebSocket subscription client for /events (Step 9 §4.3 + §2.9).
 *
 * Reconnects with exponential-backoff full-jitter (1s ceiling → 30s ceiling).
 * The WebSocket constructor and clock are injected so tests use `ws` with a
 * real Authorization header while the renderer uses the browser WebSocket
 * with token-in-subprotocol (Gus's 2026-05-22 resolution; see connectVaultStateSubscription.ts).
 */

const BASE_DELAY_MS = 1000 as const
const MAX_DELAY_MS = 30000 as const

export type Topic = 'agent-lifecycle'

export interface AgentLifecycleData {
    readonly terminalId: string
    readonly source: 'claude' | 'codex' | 'opencode'
    readonly at: number
    readonly [extra: string]: unknown
}

export interface EventFrame {
    readonly type: 'event'
    readonly topic: Topic
    readonly seq: number
    readonly event: string
    readonly data: AgentLifecycleData
}

export interface GapFrame {
    readonly type: 'gap'
    readonly topic: Topic
    readonly fromSeq: number
    readonly currentSeq: number
}

export type ConnectionState =
    | { readonly kind: 'connecting'; readonly attempt: number }
    | { readonly kind: 'connected' }
    | { readonly kind: 'reconnecting'; readonly attempt: number; readonly delayMs: number }
    | { readonly kind: 'closed' }

export interface WebSocketLike {
    readonly readyState: number
    readonly send: (data: string) => void
    readonly close: (code?: number, reason?: string) => void
    onopen: ((event?: unknown) => void) | null
    onmessage: ((event: { readonly data: unknown }) => void) | null
    onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null
    onerror: ((event?: unknown) => void) | null
}

export type WebSocketFactory = (eventsUrl: string, token: string) => WebSocketLike

export interface EventSubscriptionConfig {
    readonly getDaemonUrl: () => Promise<string>
    /** Called fresh on every connect — covers close 1008 (token rotated). */
    readonly getAuthToken: () => Promise<string>
    readonly topics: readonly Topic[]
    readonly onEvent: (frame: EventFrame) => void
    readonly onGap: (frame: GapFrame) => void
    readonly onConnectionState?: (state: ConnectionState) => void
    readonly webSocketFactory: WebSocketFactory
    readonly random?: () => number
    readonly setTimeoutImpl?: typeof globalThis.setTimeout
    readonly clearTimeoutImpl?: typeof globalThis.clearTimeout
}

export interface EventSubscriptionHandle {
    readonly close: () => void
    readonly getConnectionState: () => ConnectionState
}

export function eventsUrlFromDaemonUrl(daemonUrl: string): string {
    const url: URL = new URL('/events', daemonUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
}

/** Full-jitter exponential backoff per §2.9: random() * min(MAX, BASE * 2^(attempt-1)). */
export function computeBackoffDelayMs(attempt: number, random: () => number): number {
    if (attempt < 1) return 0
    const ceiling: number = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1))
    return Math.floor(random() * ceiling)
}

function decodeMessage(data: unknown): string {
    if (typeof data === 'string') return data
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return (data as Buffer).toString('utf-8')
    return ''
}

function parseFrame(raw: string): EventFrame | GapFrame | null {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return null }
    if (typeof parsed !== 'object' || parsed === null) return null
    const f = parsed as { readonly type?: unknown; readonly topic?: unknown; readonly seq?: unknown; readonly fromSeq?: unknown; readonly currentSeq?: unknown }
    const topicOk: boolean = f.topic === 'agent-lifecycle'
    if (!topicOk) return null
    if (f.type === 'event' && typeof f.seq === 'number') return parsed as EventFrame
    if (f.type === 'gap' && typeof f.fromSeq === 'number' && typeof f.currentSeq === 'number') return parsed as GapFrame
    return null
}

export function createEventSubscription(config: EventSubscriptionConfig): EventSubscriptionHandle {
    const random: () => number = config.random ?? Math.random
    const setTimeoutFn: typeof setTimeout = config.setTimeoutImpl ?? globalThis.setTimeout
    const clearTimeoutFn: typeof clearTimeout = config.clearTimeoutImpl ?? globalThis.clearTimeout

    const lastSeen: Map<Topic, number> = new Map()
    for (const topic of config.topics) lastSeen.set(topic, 0)

    let state: ConnectionState = { kind: 'closed' }
    let currentWs: WebSocketLike | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt: number = 0
    let closed: boolean = false

    function emitState(next: ConnectionState): void {
        state = next
        config.onConnectionState?.(next)
    }

    function cancelReconnect(): void {
        if (reconnectTimer !== null) {
            clearTimeoutFn(reconnectTimer)
            reconnectTimer = null
        }
    }

    function scheduleReconnect(): void {
        if (closed) return
        attempt += 1
        const delay: number = computeBackoffDelayMs(attempt, random)
        emitState({ kind: 'reconnecting', attempt, delayMs: delay })
        cancelReconnect()
        reconnectTimer = setTimeoutFn(() => {
            reconnectTimer = null
            void openConnection()
        }, delay)
    }

    function subscribePayload(): string {
        return JSON.stringify({
            op: 'subscribe',
            topics: config.topics.map((topic: Topic) => ({ topic, resumeSeq: lastSeen.get(topic) ?? 0 })),
        })
    }

    function dispatchFrame(raw: string): void {
        const frame: EventFrame | GapFrame | null = parseFrame(raw)
        if (!frame) return
        if (frame.type === 'event') {
            const prev: number = lastSeen.get(frame.topic) ?? 0
            if (frame.seq > prev) lastSeen.set(frame.topic, frame.seq)
            config.onEvent(frame)
        } else {
            // gap: jump forward to currentSeq; caller resnapshots via /rpc.
            lastSeen.set(frame.topic, frame.currentSeq)
            config.onGap(frame)
        }
    }

    async function openConnection(): Promise<void> {
        if (closed) return
        cancelReconnect()
        emitState({ kind: 'connecting', attempt: attempt === 0 ? 1 : attempt })

        let daemonUrl: string
        let token: string
        try {
            daemonUrl = await config.getDaemonUrl()
            token = await config.getAuthToken()
        } catch {
            scheduleReconnect()
            return
        }
        if (closed) return

        let ws: WebSocketLike
        try {
            ws = config.webSocketFactory(eventsUrlFromDaemonUrl(daemonUrl), token)
        } catch {
            scheduleReconnect()
            return
        }
        currentWs = ws

        ws.onopen = (): void => {
            if (currentWs !== ws) return
            attempt = 0
            emitState({ kind: 'connected' })
            try { ws.send(subscribePayload()) } catch { /* onclose handles */ }
        }

        ws.onmessage = (event: { readonly data: unknown }): void => {
            if (currentWs !== ws) return
            const text: string = decodeMessage(event.data)
            if (text) dispatchFrame(text)
        }

        ws.onclose = (): void => {
            if (currentWs !== ws) return
            currentWs = null
            if (closed) { emitState({ kind: 'closed' }); return }
            scheduleReconnect()
        }

        ws.onerror = (): void => { /* onclose is the canonical retry trigger */ }
    }

    void openConnection()

    return {
        close: (): void => {
            if (closed) return
            closed = true
            cancelReconnect()
            const ws: WebSocketLike | null = currentWs
            currentWs = null
            emitState({ kind: 'closed' })
            try { ws?.close(1000, 'client closing') } catch { /* best-effort */ }
        },
        getConnectionState: (): ConnectionState => state,
    }
}
