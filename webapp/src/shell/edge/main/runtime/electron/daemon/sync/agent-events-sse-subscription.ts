/**
 * Main-side SSE subscriber for the per-vault VTD's `/sessions/<id>/agent-events`
 * route (BF-376). Patterned on `daemon-sse-subscription.ts` (graph SSE) — same
 * silence-timeout-then-reconnect protocol, same `?since=<lastSeenSeq>` resume.
 *
 * Owns no terminal state itself. Each received envelope is handed to a
 * caller-supplied `onEnvelope` callback after the vault-switch fence drops
 * any frame whose `envelope.vault !== getActiveVault()` — see
 * `specs/main-host-purity/spec.md` §"Vault-switch fence drops stale events".
 *
 * Lifecycle: callers invoke `subscribeToAgentEventsSse(sessionId)` at vault-open
 * time (when `bindVtDaemonForVault` has resolved). The function tears down any
 * previous subscription, opens a fresh one, and reconnects internally on
 * transport drop. `unsubscribeFromAgentEventsSse()` clears the subscription
 * (called from `openVault` before rebinding, and from `app.will-quit`).
 *
 * `lastSeenSeq` resets to 0 on a NEW subscription key (vault swap or daemon
 * url change), and is preserved across silence-timeout reconnects so the hub's
 * replay buffer fills the gap.
 */

import {getActiveVault, getAuthToken, getDaemonUrl} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'

const SSE_SILENCE_TIMEOUT_MS: number = 45_000
const RECONNECT_DELAY_MS: number = 3_000

export interface AgentEventEnvelope {
    readonly kind: 'agent-events'
    readonly seq: number
    readonly event: string
    readonly data: {
        readonly terminalId: string
        readonly source: string
        readonly at: number
        readonly handlerResult: unknown
    }
    readonly vault: string
}

export interface AgentEventsGapEnvelope {
    readonly kind: 'agent-events-gap'
    readonly fromSeq: number
    readonly currentSeq: number
    readonly vault: string
}

export type AgentEventsFrame = AgentEventEnvelope | AgentEventsGapEnvelope

export type AgentEventHandler = (envelope: AgentEventEnvelope) => void

let currentController: AbortController | null = null
let currentReconnectTimer: ReturnType<typeof setTimeout> | null = null
let currentSubscriptionKey: string | null = null
let lastSeenSeq: number = 0
let currentHandler: AgentEventHandler | null = null
let lockedForTest: boolean = false

function clearReconnectTimer(): void {
    if (currentReconnectTimer !== null) {
        clearTimeout(currentReconnectTimer)
        currentReconnectTimer = null
    }
}

/**
 * Parse a single SSE block (already split on '\n\n'). The block has a
 * leading `data:` line carrying a JSON-encoded `AgentEventsFrame`.
 */
export function parseAgentEventsBlock(block: string): AgentEventsFrame | null {
    const dataLine: string | undefined = block
        .split('\n')
        .find((line: string): boolean => line.startsWith('data:'))
    if (!dataLine) return null
    let parsed: unknown
    try {
        parsed = JSON.parse(dataLine.slice('data:'.length).trim())
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null) return null
    const p = parsed as Record<string, unknown>
    if (p.kind === 'agent-events' && typeof p.seq === 'number' && typeof p.event === 'string'
        && typeof p.vault === 'string' && typeof p.data === 'object' && p.data !== null) {
        const d = p.data as Record<string, unknown>
        if (typeof d.terminalId === 'string' && typeof d.source === 'string' && typeof d.at === 'number') {
            return {
                kind: 'agent-events',
                seq: p.seq,
                event: p.event,
                data: {
                    terminalId: d.terminalId,
                    source: d.source,
                    at: d.at,
                    handlerResult: d.handlerResult,
                },
                vault: p.vault,
            }
        }
    }
    if (p.kind === 'agent-events-gap' && typeof p.fromSeq === 'number'
        && typeof p.currentSeq === 'number' && typeof p.vault === 'string') {
        return {
            kind: 'agent-events-gap',
            fromSeq: p.fromSeq,
            currentSeq: p.currentSeq,
            vault: p.vault,
        }
    }
    return null
}

async function connectToAgentEventsSse(
    sessionId: string,
    baseUrl: string,
    token: string,
    controller: AbortController,
): Promise<void> {
    const response: Response = await fetch(
        `${baseUrl}/sessions/${sessionId}/agent-events?since=${lastSeenSeq}`,
        {
            headers: {Authorization: `Bearer ${token}`},
            signal: controller.signal,
        },
    )
    if (!response.ok || !response.body) {
        throw new Error(`Agent-events SSE subscription failed with status ${response.status}`)
    }

    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader()
    const decoder: TextDecoder = new TextDecoder()
    let buffered: string = ''

    while (!controller.signal.aborted) {
        let silenceTimer: ReturnType<typeof setTimeout> | null = null
        const timeout: Promise<null> = new Promise<null>((resolve) => {
            silenceTimer = setTimeout((): void => resolve(null), SSE_SILENCE_TIMEOUT_MS)
            controller.signal.addEventListener('abort', (): void => {
                if (silenceTimer !== null) clearTimeout(silenceTimer)
            }, {once: true})
        })

        const result: ReadableStreamReadResult<Uint8Array> | null = await Promise.race([
            reader.read(),
            timeout,
        ])
        if (silenceTimer !== null) clearTimeout(silenceTimer)

        if (result === null) {
            reader.cancel().catch((): void => {})
            return // silence timeout — caller will reconnect
        }
        if (result.done) break

        buffered += decoder.decode(result.value, {stream: true})
        const blocks: string[] = buffered.split('\n\n')
        buffered = blocks.pop() ?? ''
        for (const block of blocks) {
            const frame: AgentEventsFrame | null = parseAgentEventsBlock(block)
            if (frame === null) continue
            // Vault-switch fence — drop frames addressed to the prior vault.
            // The fence consults the synchronous accessor on
            // `daemon-url-binding`, which is authoritative the instant
            // `bindVtDaemonForVault` resolves (see its `chain<T>` serialisation).
            const activeVault: string | null = getActiveVault()
            if (activeVault === null || frame.vault !== activeVault) continue
            if (frame.kind === 'agent-events-gap') {
                // Buffer rotated past the resume point — accept and continue;
                // current consumers do not need a resnapshot today because the
                // in-process registry is independently authoritative for
                // existing records. Future RPC fan-out will surface a richer
                // gap signal; for now, just bump lastSeenSeq.
                lastSeenSeq = Math.max(lastSeenSeq, frame.currentSeq)
                continue
            }
            lastSeenSeq = Math.max(lastSeenSeq, frame.seq)
            currentHandler?.(frame)
        }
    }
}

function scheduleReconnect(
    sessionId: string,
    controller: AbortController,
): void {
    if (controller.signal.aborted || currentController !== controller) return
    clearReconnectTimer()
    currentReconnectTimer = setTimeout((): void => {
        if (controller.signal.aborted || currentController !== controller) return
        startConnectionLoop(sessionId)
    }, RECONNECT_DELAY_MS)
}

function startConnectionLoop(sessionId: string): void {
    if (lockedForTest) return
    const controller: AbortController = new AbortController()
    currentController = controller

    void (async (): Promise<void> => {
        let baseUrl: string
        let token: string
        try {
            baseUrl = await getDaemonUrl()
            token = await getAuthToken()
        } catch (error: unknown) {
            if (controller.signal.aborted || currentController !== controller) return
            console.warn('[agent-events SSE] daemon URL/token unavailable; reconnecting', error)
            scheduleReconnect(sessionId, controller)
            return
        }
        if (controller.signal.aborted || currentController !== controller) return
        try {
            await connectToAgentEventsSse(sessionId, baseUrl, token, controller)
            if (!controller.signal.aborted && currentController === controller) {
                scheduleReconnect(sessionId, controller)
            }
        } catch (error: unknown) {
            if (controller.signal.aborted || currentController !== controller) return
            console.warn('[agent-events SSE] stream error; reconnecting', error)
            scheduleReconnect(sessionId, controller)
        }
    })().catch((): void => {})
}

/**
 * Open (or re-open) the agent-events SSE subscription. Tears down any
 * existing subscription first. `sessionId` matches the route segment of
 * `/sessions/<sessionId>/agent-events` on VTD; today VTD ignores the
 * sessionId (it's a single per-vault hub), but the path shape mirrors the
 * graph SSE pattern so the wire is consistent.
 *
 * `onEnvelope` is invoked for every frame that passes the vault-switch
 * fence. The caller owns whatever side effect (e.g. forwarding to the
 * in-process terminal registry).
 */
export function subscribeToAgentEventsSse(
    sessionId: string,
    onEnvelope: AgentEventHandler,
): void {
    if (lockedForTest) return
    unsubscribeFromAgentEventsSse()
    const subscriptionKey: string = sessionId
    if (currentSubscriptionKey !== subscriptionKey) {
        currentSubscriptionKey = subscriptionKey
        lastSeenSeq = 0
    }
    currentHandler = onEnvelope
    startConnectionLoop(sessionId)
}

export function unsubscribeFromAgentEventsSse(): void {
    clearReconnectTimer()
    currentController?.abort()
    currentController = null
    currentHandler = null
}

export function __debugLockAgentEventsSSE(): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('Test-only API')
    unsubscribeFromAgentEventsSse()
    lockedForTest = true
}

export function __debugUnlockAgentEventsSSE(): void {
    if (process.env.NODE_ENV !== 'test') throw new Error('Test-only API')
    lockedForTest = false
}
