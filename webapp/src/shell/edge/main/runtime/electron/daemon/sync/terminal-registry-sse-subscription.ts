/**
 * Main-side SSE subscriber for the per-vault VTD's
 * `/sessions/<id>/terminal-registry` route (BF-376 outbound). Wire
 * protocol (JSON-encoded `data:` blocks split on `\n\n`, silence-timeout
 * reconnect, `?since=<seq>` resume) is shared with any future per-topic
 * subscriber via `sse-subscription-loop.ts`.
 *
 * Why module-level subscription state rather than a generic registry:
 * each topic owns its own controller / last-seen-seq / handler triple so
 * vault-switch teardown and parallel subscribe/unsubscribe lifecycles
 * stay independent.
 *
 * Envelope shape (`TerminalRegistryEvent`) is owned by
 * `@vt/vt-daemon-protocol`. Gap envelopes are dropped from the handler
 * — the cache mirror that consumes terminal-registry deltas can
 * re-snapshot via `getTerminalRecords` RPC on demand. (The gap envelope
 * still advances `lastSeenSeq` so the next reconnect resumes past the
 * lost range.)
 */

import {TERMINAL_REGISTRY_EVENT_TYPES, type TerminalRegistryEvent} from '@vt/vt-daemon-client'

import {
    createSseSubscriptionRunner,
    type FrameClassification,
    type SseTopicConfig,
} from './sse-subscription-loop'

const TERMINAL_REGISTRY_PATH_SUFFIX: string = '/terminal-registry'

/**
 * Wire envelope carrying one `TerminalRegistryEvent` payload, plus the
 * hub-side metadata (monotonic seq, canonical vault) the loop needs for
 * its resume cursor and vault-switch fence.
 */
export interface TerminalRegistryEnvelope {
    readonly kind: 'terminal-registry'
    readonly seq: number
    readonly event: TerminalRegistryEvent
    readonly vault: string
}

/**
 * Gap envelope — emitted when the daemon's per-topic resume buffer
 * rotated past the consumer's `?since=` cursor. The cache mirror should
 * re-snapshot via `getTerminalRecords` RPC on receipt, but this
 * subscriber's job is only to advance `lastSeenSeq` so the next
 * reconnect resumes coherently.
 */
export interface TerminalRegistryGapEnvelope {
    readonly kind: 'terminal-registry-gap'
    readonly fromSeq: number
    readonly currentSeq: number
    readonly vault: string
}

export type TerminalRegistryFrame =
    | TerminalRegistryEnvelope
    | TerminalRegistryGapEnvelope

export type TerminalRegistryEnvelopeHandler = (envelope: TerminalRegistryEnvelope) => void

/**
 * Parse a single SSE block (already split on '\n\n') into a
 * {@link TerminalRegistryFrame}. Returns null on missing/unrecognised
 * shape.
 */
export function parseTerminalRegistryBlock(block: string): TerminalRegistryFrame | null {
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
    if (p.kind === 'terminal-registry' && typeof p.seq === 'number'
        && typeof p.vault === 'string' && typeof p.event === 'object' && p.event !== null) {
        const event = p.event as Record<string, unknown>
        if (typeof event.type !== 'string') return null
        if (!(TERMINAL_REGISTRY_EVENT_TYPES as readonly string[]).includes(event.type)) return null
        return {
            kind: 'terminal-registry',
            seq: p.seq,
            event: p.event as TerminalRegistryEvent,
            vault: p.vault,
        }
    }
    if (p.kind === 'terminal-registry-gap' && typeof p.fromSeq === 'number'
        && typeof p.currentSeq === 'number' && typeof p.vault === 'string') {
        return {
            kind: 'terminal-registry-gap',
            fromSeq: p.fromSeq,
            currentSeq: p.currentSeq,
            vault: p.vault,
        }
    }
    return null
}

function classifyTerminalRegistryFrame(frame: TerminalRegistryFrame): FrameClassification {
    if (frame.kind === 'terminal-registry-gap') {
        // Advance the resume cursor past the gap; do not deliver to the
        // handler (the handler is typed for envelopes, and gap handling
        // belongs to the consumer cache via re-snapshot).
        return {vault: frame.vault, advanceSeq: frame.currentSeq, deliver: false}
    }
    return {vault: frame.vault, advanceSeq: frame.seq, deliver: true}
}

const TERMINAL_REGISTRY_CONFIG: SseTopicConfig<TerminalRegistryFrame> = {
    topicLabel: 'terminal-registry',
    buildResumeUrl: (baseUrl: string, sessionId: string, sinceSeq: number): string =>
        `${baseUrl}/sessions/${sessionId}${TERMINAL_REGISTRY_PATH_SUFFIX}?since=${sinceSeq}`,
    parseBlock: parseTerminalRegistryBlock,
    classifyFrame: classifyTerminalRegistryFrame,
}

// One subscription runner per topic, module-level. The runner is closed
// over the current handler and updated by `subscribeToTerminalRegistrySse`.
let currentHandler: TerminalRegistryEnvelopeHandler | null = null
const runner = createSseSubscriptionRunner<TerminalRegistryFrame>(
    TERMINAL_REGISTRY_CONFIG,
    (frame: TerminalRegistryFrame): void => {
        if (frame.kind !== 'terminal-registry') return
        currentHandler?.(frame)
    },
)

/**
 * Open (or re-open) the terminal-registry SSE subscription. Tears down
 * any existing subscription first.
 *
 * `onEnvelope` is invoked for every envelope that passes the vault-switch
 * fence; the caller owns whatever side effect (typically forwarding to
 * the local cache mirror).
 */
export function subscribeToTerminalRegistrySse(
    sessionId: string,
    onEnvelope: TerminalRegistryEnvelopeHandler,
): void {
    currentHandler = onEnvelope
    runner.start(sessionId)
}

export function unsubscribeFromTerminalRegistrySse(): void {
    runner.stop()
    currentHandler = null
}

export function __debugLockTerminalRegistrySSE(): void {
    runner.lockForTest()
    currentHandler = null
}

export function __debugUnlockTerminalRegistrySSE(): void {
    runner.unlockForTest()
}
