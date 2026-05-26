/**
 * Topic-agnostic SSE subscription loop shared by every per-vault VTD
 * subscriber in this directory (Leaf B's `agent-events`, BF-376's
 * `terminal-registry`, and any future topic that rides the same wire).
 *
 * Owns the impure parts — fetch lifecycle, abort signal plumbing, silence
 * timeout, '\n\n' block framing, reconnect backoff. The topic-specific
 * caller supplies only:
 *   - a URL builder (`{baseUrl}/sessions/<id>/<topicPath>?since=<seq>`),
 *   - a block→frame parser,
 *   - frame metadata (`vault`, advance-`seq`, deliver?),
 *   - an `onEnvelope` handler invoked for delivered frames.
 *
 * Why a helper instead of two near-duplicate subscriber files: the loop
 * mechanics are non-trivial (silence Promise race, AbortController
 * cancellation propagation, reconnect token versioning to suppress
 * stale-loop callbacks) and have already shipped once in
 * `agent-events-sse-subscription.ts`. A second copy of the same logic
 * would drift; one home keeps the silence-timeout / reconnect protocol
 * uniform across topics.
 *
 * What still lives per-topic: module-level "current subscription" state
 * (the controller / handler / lastSeenSeq triple) — each topic owns its
 * own subscription, so each subscriber file holds its own state and
 * passes a fresh {@link SseSubscriptionRunner} to this helper on each
 * `subscribe` call. The helper itself is stateless across calls.
 */

import {getActiveVault, getAuthToken, getDaemonUrl} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'

const SSE_SILENCE_TIMEOUT_MS: number = 45_000
const RECONNECT_DELAY_MS: number = 3_000

/**
 * Per-frame classification returned by the topic-specific
 * {@link SseTopicConfig.classifyFrame}. The loop uses the result to (a)
 * advance the resume cursor and (b) decide whether to deliver to the
 * caller's handler.
 */
export interface FrameClassification {
    /**
     * Frame's authoritative vault. The loop applies the vault-switch
     * fence: a frame whose vault does not match `getActiveVault()` is
     * silently dropped (no handler call, no seq advance).
     */
    readonly vault: string
    /**
     * Seq value the loop should advance `lastSeenSeq` to (using `Math.max`).
     * For envelopes this is the envelope seq; for gaps this is the gap's
     * `currentSeq`. Null = don't advance.
     */
    readonly advanceSeq: number | null
    /**
     * True iff the loop should call `onEnvelope(frame)` after the fence
     * check. Gaps typically set this to false and rely on seq advancement
     * to fill the buffer-overrun gap on the next reconnect.
     */
    readonly deliver: boolean
}

export interface SseTopicConfig<F> {
    /** Used only in `console.warn` messages — never reaches the wire. */
    readonly topicLabel: string
    /**
     * Build the resume URL the loop fetches. Receives the (already
     * trailing-slash-stripped) base URL, the sessionId the caller
     * supplied, and the current resume cursor.
     */
    readonly buildResumeUrl: (
        baseUrl: string,
        sessionId: string,
        sinceSeq: number,
    ) => string
    /**
     * Parse one SSE block (already split on '\n\n', leading `data:` line
     * intact). Return null for unrecognised blocks; the loop drops them
     * silently.
     */
    readonly parseBlock: (block: string) => F | null
    /**
     * Classify a parsed frame — vault for fence, seq for resume cursor,
     * deliver flag for the handler. Return null to drop entirely (e.g.
     * a frame whose discriminator is recognised but whose payload is
     * malformed).
     */
    readonly classifyFrame: (frame: F) => FrameClassification | null
}

export interface SseSubscriptionRunner {
    /** Open (or re-open) the subscription. Tears down any prior loop first. */
    readonly start: (sessionId: string) => void
    /** Abort the in-flight fetch and cancel any pending reconnect. */
    readonly stop: () => void
    /**
     * Test-only hatch — prevents `start` from doing anything until
     * matched by {@link unlock}. Mirrors Leaf B's
     * `__debugLockAgentEventsSSE` / `__debugUnlockAgentEventsSSE` pair.
     */
    readonly lockForTest: () => void
    readonly unlockForTest: () => void
}

/**
 * Build a subscription runner for one topic. Each call returns a fresh
 * runner with its own state — `agent-events` and `terminal-registry`
 * each hold their own runner module-level so vault-switch can tear them
 * down independently.
 *
 * The handler receives only frames that (a) passed the vault fence and
 * (b) had `deliver: true` from `classifyFrame`.
 */
export function createSseSubscriptionRunner<F>(
    config: SseTopicConfig<F>,
    onEnvelope: (frame: F) => void,
): SseSubscriptionRunner {
    let currentController: AbortController | null = null
    let currentReconnectTimer: ReturnType<typeof setTimeout> | null = null
    let currentSubscriptionKey: string | null = null
    let lastSeenSeq: number = 0
    let lockedForTest: boolean = false

    function clearReconnectTimer(): void {
        if (currentReconnectTimer !== null) {
            clearTimeout(currentReconnectTimer)
            currentReconnectTimer = null
        }
    }

    async function connect(
        sessionId: string,
        baseUrl: string,
        token: string,
        controller: AbortController,
    ): Promise<void> {
        const response: Response = await fetch(
            config.buildResumeUrl(baseUrl, sessionId, lastSeenSeq),
            {
                headers: {Authorization: `Bearer ${token}`},
                signal: controller.signal,
            },
        )
        if (!response.ok || !response.body) {
            throw new Error(
                `${config.topicLabel} SSE subscription failed with status ${response.status}`,
            )
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
                return // silence timeout — caller reconnects
            }
            if (result.done) break

            buffered += decoder.decode(result.value, {stream: true})
            const blocks: string[] = buffered.split('\n\n')
            buffered = blocks.pop() ?? ''
            for (const block of blocks) {
                const frame: F | null = config.parseBlock(block)
                if (frame === null) continue
                const classification: FrameClassification | null = config.classifyFrame(frame)
                if (classification === null) continue
                // Vault-switch fence — drop frames addressed to the prior
                // vault. The fence consults the synchronous accessor on
                // `daemon-url-binding`, authoritative the instant
                // `bindVtDaemonForVault` resolves (see its `chain<T>`
                // serialisation).
                const activeVault: string | null = getActiveVault()
                if (activeVault === null || classification.vault !== activeVault) continue
                if (classification.advanceSeq !== null) {
                    lastSeenSeq = Math.max(lastSeenSeq, classification.advanceSeq)
                }
                if (classification.deliver) onEnvelope(frame)
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
                console.warn(`[${config.topicLabel} SSE] daemon URL/token unavailable; reconnecting`, error)
                scheduleReconnect(sessionId, controller)
                return
            }
            if (controller.signal.aborted || currentController !== controller) return
            try {
                await connect(sessionId, baseUrl, token, controller)
                if (!controller.signal.aborted && currentController === controller) {
                    scheduleReconnect(sessionId, controller)
                }
            } catch (error: unknown) {
                if (controller.signal.aborted || currentController !== controller) return
                console.warn(`[${config.topicLabel} SSE] stream error; reconnecting`, error)
                scheduleReconnect(sessionId, controller)
            }
        })().catch((): void => {})
    }

    return {
        start: (sessionId: string): void => {
            if (lockedForTest) return
            // Tear down any prior subscription before opening a new one.
            clearReconnectTimer()
            currentController?.abort()
            currentController = null
            if (currentSubscriptionKey !== sessionId) {
                currentSubscriptionKey = sessionId
                lastSeenSeq = 0
            }
            startConnectionLoop(sessionId)
        },
        stop: (): void => {
            clearReconnectTimer()
            currentController?.abort()
            currentController = null
        },
        lockForTest: (): void => {
            if (process.env.NODE_ENV !== 'test') throw new Error('Test-only API')
            clearReconnectTimer()
            currentController?.abort()
            currentController = null
            lockedForTest = true
        },
        unlockForTest: (): void => {
            if (process.env.NODE_ENV !== 'test') throw new Error('Test-only API')
            lockedForTest = false
        },
    }
}
