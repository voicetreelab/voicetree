// SSE bridge from the `agent-events` topic on the in-process hub onto an
// HTTP text/event-stream channel. Mirrors the per-vault graph SSE pattern
// used by `webapp/src/shell/edge/main/runtime/electron/daemon/sync/daemon-sse-subscription.ts`
// (`GET /sessions/<id>/events?since=<seq>`). One SSE block per published
// hub event; `data:` line carries the JSON envelope.
//
// Envelope shape (cross-package contract; matches `@vt/vt-rpc`'s
// `AgentEventEnvelope`):
//   {
//     kind:  'agent-events',
//     seq:   <hub monotonic seq>,
//     event: <claude-code hook event name>,
//     data:  {terminalId, source, at, handlerResult},
//     vault: <canonical absolute path>,
//   }
//
// The route is bearer-auth-gated (caller checks `isAuthorized` before
// reaching `handleAgentEventsSse`). `?since=<seq>` resumes from the hub's
// per-topic buffer (the hub's gap-frame protocol is internal — on the wire
// we project gaps as a normal `kind: 'agent-events-gap'` block so a single
// stream reader handles both).

import type {IncomingMessage, ServerResponse} from 'node:http'

import type {EventSubscriptionHub, SubscriberHandle} from './eventSubscriptionHub.ts'

const AGENT_EVENTS_PATH_PREFIX: string = '/sessions/'
const AGENT_EVENTS_PATH_SUFFIX: string = '/agent-events'

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

/**
 * Match `/sessions/<sessionId>/agent-events` (no trailing slash, no extra
 * path segments). Returns the sessionId or null.
 */
export function matchAgentEventsPath(pathname: string): string | null {
    if (!pathname.startsWith(AGENT_EVENTS_PATH_PREFIX)) return null
    if (!pathname.endsWith(AGENT_EVENTS_PATH_SUFFIX)) return null
    const sessionId: string = pathname.slice(
        AGENT_EVENTS_PATH_PREFIX.length,
        pathname.length - AGENT_EVENTS_PATH_SUFFIX.length,
    )
    // sessionId must be a single non-empty segment (no '/').
    if (sessionId.length === 0 || sessionId.includes('/')) return null
    return sessionId
}

/**
 * Parse the `?since=<n>` query param. Returns 0 on absence / non-finite.
 */
export function parseSinceQuery(rawUrl: string): number {
    const url: URL = new URL(rawUrl, 'http://127.0.0.1')
    const raw: string | null = url.searchParams.get('since')
    if (raw === null) return 0
    const n: number = Number.parseInt(raw, 10)
    return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Project a raw hub publish envelope onto the wire envelope. The hub stores
 * `data: unknown`; the publish site at httpServer.handleHook writes the
 * expected `{terminalId, source, at, handlerResult}` shape, and we widen to
 * `unknown` on handlerResult per the spec's "loose typing" call-out.
 */
export function projectHubEventToEnvelope(
    seq: number,
    event: string,
    data: unknown,
    vault: string,
): AgentEventEnvelope | null {
    if (typeof data !== 'object' || data === null) return null
    const d = data as Record<string, unknown>
    if (typeof d.terminalId !== 'string') return null
    if (typeof d.source !== 'string') return null
    if (typeof d.at !== 'number') return null
    return {
        kind: 'agent-events',
        seq,
        event,
        data: {
            terminalId: d.terminalId,
            source: d.source,
            at: d.at,
            handlerResult: d.handlerResult,
        },
        vault,
    }
}

/**
 * Encode a wire envelope as a single SSE block. The leading `data:` line and
 * the trailing blank line are required by the SSE protocol. JSON is emitted
 * on a single line so consumers can split on '\n\n' without re-assembly.
 */
export function encodeSseBlock(envelope: AgentEventsFrame): string {
    return `data: ${JSON.stringify(envelope)}\n\n`
}

export interface AgentEventsSseOptions {
    readonly hub: EventSubscriptionHub
    readonly canonicalVault: string
    /** Injected for tests; defaults to the project's hub frame protocol. */
    readonly resumeSeq: number
}

/**
 * Handle a `GET /sessions/<id>/agent-events` request. Writes SSE headers,
 * subscribes to the hub with `resumeSeq`, projects each hub frame onto the
 * AgentEventEnvelope wire shape, and returns when the response stream
 * closes (client disconnect, daemon shutdown, error).
 *
 * The hub's serialized frames carry `{type: 'event' | 'gap', topic, seq, ...}`;
 * we re-parse them here and project. We could read the in-memory topic
 * buffer directly, but the existing addSubscriber + resumeSeq path already
 * encapsulates the replay-buffer semantics — bypassing it would duplicate
 * the gap-detection logic.
 */
export function handleAgentEventsSse(
    _req: IncomingMessage,
    res: ServerResponse,
    options: AgentEventsSseOptions,
): void {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    let closed: boolean = false
    const handle: SubscriberHandle = options.hub.addSubscriber({
        send: (frame: string): void => {
            if (closed) return
            // Hub frames are JSON-serialized {type, topic, seq, event, data}
            // or {type:'gap', topic, fromSeq, currentSeq}. Project onto the
            // SSE envelope; emit nothing for frames whose `data` doesn't
            // match the expected hook-event shape (defensive — hub callers
            // should always send the right shape, but the wire is the
            // contract).
            let parsed: unknown
            try { parsed = JSON.parse(frame) } catch { return }
            if (typeof parsed !== 'object' || parsed === null) return
            const p = parsed as Record<string, unknown>
            if (p.type === 'event' && typeof p.seq === 'number' && typeof p.event === 'string') {
                const envelope: AgentEventEnvelope | null = projectHubEventToEnvelope(
                    p.seq, p.event, p.data, options.canonicalVault,
                )
                if (envelope) res.write(encodeSseBlock(envelope))
                return
            }
            if (p.type === 'gap' && typeof p.fromSeq === 'number' && typeof p.currentSeq === 'number') {
                const gap: AgentEventsGapEnvelope = {
                    kind: 'agent-events-gap',
                    fromSeq: p.fromSeq,
                    currentSeq: p.currentSeq,
                    vault: options.canonicalVault,
                }
                res.write(encodeSseBlock(gap))
                return
            }
        },
        overflow: (): void => {
            // Hub overflow → close the SSE stream so the consumer reconnects
            // with a fresh resume. The hub's per-subscriber outbound queue
            // ceiling already protects us; we just translate the signal.
            if (closed) return
            closed = true
            handle.close()
            res.end()
        },
    })

    handle.subscribe([{topic: 'agent-events', resumeSeq: options.resumeSeq}])

    const onClose = (): void => {
        if (closed) return
        closed = true
        handle.close()
    }
    res.once('close', onClose)
    res.once('error', onClose)
}
