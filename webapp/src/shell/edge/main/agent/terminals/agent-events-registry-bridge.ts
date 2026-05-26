/**
 * Bridges agent-events SSE frames (from the per-vault VTD) into Main's
 * in-process terminal-registry by calling `updateTerminalAgentEvent`.
 *
 * The renderer-visible terminal status badge is driven by the in-process
 * `terminal-registry`'s subscribers. After BF-375 deleted
 * `http-server-binding.ts`, the in-process callback path that fed those
 * subscribers (vt-daemon's `hookHandler` calling `updateTerminalAgentEvent`)
 * was gone — hook events arriving at VTD never reached Main's registry. This
 * bridge restores the pipeline via the SSE channel introduced by BF-376:
 *   VTD: POST /hook/claude-code  →  hub.publish('agent-events', …)
 *   Main: GET /sessions/<id>/agent-events  →  this bridge  →
 *         agentRuntime.updateTerminalAgentEvent  →  renderer
 *
 * The vault-switch fence is enforced upstream by
 * `agent-events-sse-subscription.ts`; this module only sees frames that
 * passed the fence. The envelope's `handlerResult` is the JSON-RPC return
 * of VTD's `handleHookEventRequest`, which carries the `AgentEventKind`
 * on success — so this bridge reuses VTD's mapping rather than duplicating
 * it. Frames whose handlerResult is `{ok: false, ...}` or `{ignored: true}`
 * are dropped (the bridge is a forwarder, not a re-classifier).
 *
 * NOTE (half-cutover honesty): post-BF-376, Main still runs an in-process
 * `@vt/agent-runtime` instance for outbound surface (spawn, send, …) — the
 * outbound RPC fan-out is deferred to a follow-on BF. This bridge is what
 * keeps the inbound side coherent until that lands.
 */

import {agentRuntime} from '@vt/agent-runtime'
import type {AgentEventKind} from '@vt/agent-runtime'

import type {AgentEventEnvelope} from '@/shell/edge/main/runtime/electron/daemon/sync/agent-events-sse-subscription'

interface VtdHookHandlerSuccess {
    readonly ok: true
    readonly kind: AgentEventKind
}

interface VtdHookHandlerIgnored {
    readonly ok: true
    readonly ignored: true
    readonly eventName: string
}

interface VtdHookHandlerFailure {
    readonly ok: false
    readonly reason: string
}

type VtdHookHandlerResponse = VtdHookHandlerSuccess | VtdHookHandlerIgnored | VtdHookHandlerFailure

function isHookHandlerResponse(value: unknown): value is VtdHookHandlerResponse {
    if (typeof value !== 'object' || value === null) return false
    const v = value as Record<string, unknown>
    return typeof v.ok === 'boolean'
}

function extractAgentEventKind(handlerResult: unknown): AgentEventKind | null {
    if (!isHookHandlerResponse(handlerResult)) return null
    if (!handlerResult.ok) return null
    if ('ignored' in handlerResult) return null
    return handlerResult.kind
}

/**
 * Forward a single agent-events envelope into the in-process terminal
 * registry. Returns true iff the envelope drove a registry update (useful
 * for tests).
 */
export function forwardAgentEventToRegistry(envelope: AgentEventEnvelope): boolean {
    const kind: AgentEventKind | null = extractAgentEventKind(envelope.data.handlerResult)
    if (kind === null) return false
    agentRuntime.updateTerminalAgentEvent(envelope.data.terminalId, kind)
    return true
}
