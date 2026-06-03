// SSE bridge from the `terminal-registry` topic on the in-process hub onto
// an HTTP text/event-stream channel. Wire envelope:
//
//   { kind: 'terminal-registry', seq, event: TerminalRegistryEvent, project }
//
// The hub-side publish (see vt-daemon/bin/vtd.ts#buildPublishTerminalRegistryEvent)
// stores each event under `event=<event.type>` and `data=<full TerminalRegistryEvent>`.
// Projection here therefore ignores the hub's `event` string and forwards
// the full payload as the wire envelope's `event` field, matching the
// consumer's `parseTerminalRegistryBlock` (see
// webapp/.../terminal-registry-sse-subscription.ts).
//
// The route is bearer-auth-gated (the caller checks `isAuthorized` before
// reaching `handleTerminalRegistrySse`). `?since=<seq>` resumes from the
// hub's per-topic buffer; buffer-overrun gaps are projected onto the wire as
// a `kind: 'terminal-registry-gap'` block so a single stream reader handles
// both event and gap frames.

import type {IncomingMessage, ServerResponse} from 'node:http'

import {
    TERMINAL_REGISTRY_EVENT_TYPES,
    type TerminalRegistryEvent,
} from '@vt/vt-daemon-protocol'

import type {EventSubscriptionHub, SubscriberHandle} from './eventSubscriptionHub.ts'

const TERMINAL_REGISTRY_PATH_PREFIX: string = '/sessions/'
const TERMINAL_REGISTRY_PATH_SUFFIX: string = '/terminal-registry'

export interface TerminalRegistryEnvelope {
    readonly kind: 'terminal-registry'
    readonly seq: number
    readonly event: TerminalRegistryEvent
    readonly project: string
}

export interface TerminalRegistryGapEnvelope {
    readonly kind: 'terminal-registry-gap'
    readonly fromSeq: number
    readonly currentSeq: number
    readonly project: string
}

export type TerminalRegistryFrame =
    | TerminalRegistryEnvelope
    | TerminalRegistryGapEnvelope

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
 * Match `/sessions/<sessionId>/terminal-registry` (no trailing slash, no
 * extra path segments). Returns the sessionId or null.
 */
export function matchTerminalRegistryPath(pathname: string): string | null {
    if (!pathname.startsWith(TERMINAL_REGISTRY_PATH_PREFIX)) return null
    if (!pathname.endsWith(TERMINAL_REGISTRY_PATH_SUFFIX)) return null
    const sessionId: string = pathname.slice(
        TERMINAL_REGISTRY_PATH_PREFIX.length,
        pathname.length - TERMINAL_REGISTRY_PATH_SUFFIX.length,
    )
    if (sessionId.length === 0 || sessionId.includes('/')) return null
    return sessionId
}

/**
 * Project a hub publish payload onto the wire envelope. The hub stores
 * `data: unknown`; the publish site in vtd.ts writes the full
 * `TerminalRegistryEvent` shape. Validate the `type` discriminator
 * against the canonical event-type list before projecting so a malformed
 * publish never escapes onto the wire.
 */
export function projectHubEventToTerminalRegistryEnvelope(
    seq: number,
    data: unknown,
    project: string,
): TerminalRegistryEnvelope | null {
    if (typeof data !== 'object' || data === null) return null
    const d = data as Record<string, unknown>
    if (typeof d.type !== 'string') return null
    if (!(TERMINAL_REGISTRY_EVENT_TYPES as readonly string[]).includes(d.type)) return null
    return {
        kind: 'terminal-registry',
        seq,
        event: data as TerminalRegistryEvent,
        project,
    }
}

/**
 * Encode a wire envelope as a single SSE block: a `data:` line carrying
 * single-line JSON, followed by the required trailing blank line.
 */
export function encodeTerminalRegistrySseBlock(envelope: TerminalRegistryFrame): string {
    return `data: ${JSON.stringify(envelope)}\n\n`
}

export interface TerminalRegistrySseOptions {
    readonly hub: EventSubscriptionHub
    readonly canonicalProject: string
    readonly resumeSeq: number
}

/**
 * Handle a `GET /sessions/<id>/terminal-registry` request. Writes SSE
 * headers, subscribes to the `terminal-registry` topic with `resumeSeq`,
 * projects each hub frame onto the wire envelope, and returns when the
 * response stream closes (client disconnect, daemon shutdown, error).
 */
export function handleTerminalRegistrySse(
    _req: IncomingMessage,
    res: ServerResponse,
    options: TerminalRegistrySseOptions,
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
            let parsed: unknown
            try { parsed = JSON.parse(frame) } catch { return }
            if (typeof parsed !== 'object' || parsed === null) return
            const p = parsed as Record<string, unknown>
            if (p.type === 'event' && typeof p.seq === 'number') {
                const envelope: TerminalRegistryEnvelope | null =
                    projectHubEventToTerminalRegistryEnvelope(p.seq, p.data, options.canonicalProject)
                if (envelope) res.write(encodeTerminalRegistrySseBlock(envelope))
                return
            }
            if (p.type === 'gap' && typeof p.fromSeq === 'number' && typeof p.currentSeq === 'number') {
                const gap: TerminalRegistryGapEnvelope = {
                    kind: 'terminal-registry-gap',
                    fromSeq: p.fromSeq,
                    currentSeq: p.currentSeq,
                    project: options.canonicalProject,
                }
                res.write(encodeTerminalRegistrySseBlock(gap))
                return
            }
        },
        overflow: (): void => {
            if (closed) return
            closed = true
            handle.close()
            res.end()
        },
    })

    handle.subscribe([{topic: 'terminal-registry', resumeSeq: options.resumeSeq}])

    const onClose = (): void => {
        if (closed) return
        closed = true
        handle.close()
    }
    res.once('close', onClose)
    res.once('error', onClose)
}
