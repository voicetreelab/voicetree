/**
 * Main-process /events WebSocket client (Phase 0 / BF-367).
 *
 * Owns one WS connection per active project, bridging VTD's /events stream
 * onto Main-side callbacks. Native `Authorization: Bearer` header (Node
 * `ws` module) — no `vt-bearer` subprotocol workaround. The renderer never
 * sees the bearer token.
 *
 * Wire shape unchanged from the previous renderer-side `createEventSubscription`:
 *   server→client: { type: 'event', topic, seq, event, data }
 *   server→client: { type: 'gap',   topic, fromSeq, currentSeq }
 *   client→server: { op: 'subscribe', topics: [{ topic, resumeSeq }, …] }
 *
 * Reconnect: full-jitter exponential backoff 1s → 30s ceiling per §2.9.
 * On close code 1008 the next connect re-resolves `getAuthToken` (token
 * rotation just works because deps are promise-based — see BF-367 gotcha).
 */
import {WebSocket} from 'ws'
import type {ConnectionState, EventFrame, GapFrame, TopicName} from '@vt/vt-daemon/transport/eventTypes'

const BASE_DELAY_MS: number = 1000
const MAX_DELAY_MS: number = 30000

export interface VtDaemonEventsClientDeps {
    readonly getDaemonUrl: () => Promise<string>
    readonly getAuthToken: () => Promise<string>
    readonly topics: readonly TopicName[]
    readonly onEvent: (frame: EventFrame) => void
    readonly onConnectionState: (state: ConnectionState) => void
    readonly onGap: (frame: GapFrame) => void
    readonly random?: () => number
    readonly setTimeoutImpl?: typeof setTimeout
    readonly clearTimeoutImpl?: typeof clearTimeout
}

export interface VtDaemonEventsClient {
    readonly close: () => void
    readonly resnapshot: (topic: TopicName) => Promise<void>
}

export function eventsUrlFromDaemonUrl(daemonUrl: string): string {
    const url: URL = new URL('/events', daemonUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
}

/** Full-jitter exponential backoff (§2.9): random() * min(MAX, BASE * 2^(attempt-1)). */
export function computeBackoffDelayMs(attempt: number, random: () => number): number {
    if (attempt < 1) return 0
    const ceiling: number = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1))
    return Math.floor(random() * ceiling)
}

function decodeMessage(data: unknown): string {
    if (typeof data === 'string') return data
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('utf-8')
    if (Array.isArray(data)) return Buffer.concat(data as Buffer[]).toString('utf-8')
    return ''
}

function parseFrame(raw: string): EventFrame | GapFrame | null {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return null }
    if (typeof parsed !== 'object' || parsed === null) return null
    const f = parsed as {readonly type?: unknown; readonly topic?: unknown; readonly seq?: unknown; readonly fromSeq?: unknown; readonly currentSeq?: unknown}
    if (f.topic !== 'agent-lifecycle') return null
    if (f.type === 'event' && typeof f.seq === 'number') return parsed as EventFrame
    if (f.type === 'gap' && typeof f.fromSeq === 'number' && typeof f.currentSeq === 'number') return parsed as GapFrame
    return null
}

export function createVtDaemonEventsClient(deps: VtDaemonEventsClientDeps): VtDaemonEventsClient {
    const random: () => number = deps.random ?? Math.random
    const setTimeoutFn: typeof setTimeout = deps.setTimeoutImpl ?? globalThis.setTimeout
    const clearTimeoutFn: typeof clearTimeout = deps.clearTimeoutImpl ?? globalThis.clearTimeout

    const lastSeen: Map<TopicName, number> = new Map()
    for (const topic of deps.topics) lastSeen.set(topic, 0)

    let currentWs: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let attempt: number = 0
    let closed: boolean = false

    function emitState(next: ConnectionState): void {
        deps.onConnectionState(next)
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
        emitState({kind: 'reconnecting', attempt, delayMs: delay})
        cancelReconnect()
        reconnectTimer = setTimeoutFn((): void => {
            reconnectTimer = null
            void openConnection()
        }, delay)
    }

    function subscribePayload(): string {
        return JSON.stringify({
            op: 'subscribe',
            topics: deps.topics.map((topic: TopicName) => ({topic, resumeSeq: lastSeen.get(topic) ?? 0})),
        })
    }

    function dispatchFrame(raw: string): void {
        const frame: EventFrame | GapFrame | null = parseFrame(raw)
        if (!frame) return
        if (frame.type === 'event') {
            const prev: number = lastSeen.get(frame.topic) ?? 0
            if (frame.seq > prev) lastSeen.set(frame.topic, frame.seq)
            deps.onEvent(frame)
        } else {
            // gap: jump forward to currentSeq; caller resnapshots if it wants
            // bounded eventual consistency.
            lastSeen.set(frame.topic, frame.currentSeq)
            deps.onGap(frame)
        }
    }

    async function openConnection(): Promise<void> {
        if (closed) return
        cancelReconnect()
        emitState({kind: 'connecting', attempt: attempt === 0 ? 1 : attempt})

        let daemonUrl: string
        let token: string
        try {
            daemonUrl = await deps.getDaemonUrl()
            token = await deps.getAuthToken()
        } catch {
            scheduleReconnect()
            return
        }
        if (closed) return

        let ws: WebSocket
        try {
            ws = new WebSocket(eventsUrlFromDaemonUrl(daemonUrl), {
                headers: {Authorization: `Bearer ${token}`},
            })
        } catch {
            scheduleReconnect()
            return
        }
        currentWs = ws

        ws.on('open', (): void => {
            if (currentWs !== ws) return
            attempt = 0
            emitState({kind: 'connected'})
            try { ws.send(subscribePayload()) } catch { /* close handles */ }
        })

        ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]): void => {
            if (currentWs !== ws) return
            const text: string = decodeMessage(raw)
            if (text) dispatchFrame(text)
        })

        ws.on('close', (): void => {
            if (currentWs !== ws) return
            currentWs = null
            if (closed) { emitState({kind: 'closed'}); return }
            scheduleReconnect()
        })

        // 'error' alone is not enough to trigger reconnect — 'close' is the
        // canonical retry trigger and always follows 'error' in `ws`. Still
        // subscribe so unhandled-error doesn't crash the Main process.
        ws.on('error', (): void => { /* close handles */ })
    }

    async function resnapshot(topic: TopicName): Promise<void> {
        if (closed) return
        lastSeen.set(topic, 0)
        const ws: WebSocket | null = currentWs
        currentWs = null
        try { ws?.close(1000, 'resnapshot') } catch { /* best-effort */ }
        await openConnection()
    }

    void openConnection()

    return {
        close: (): void => {
            if (closed) return
            closed = true
            cancelReconnect()
            const ws: WebSocket | null = currentWs
            currentWs = null
            emitState({kind: 'closed'})
            try { ws?.close(1000, 'client closing') } catch { /* best-effort */ }
        },
        resnapshot,
    }
}
