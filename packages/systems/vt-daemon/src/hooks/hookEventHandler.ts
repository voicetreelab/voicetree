/**
 * Pure handler for an incoming agent hook request. Validates inputs, maps the
 * event name to AgentEventKind, and invokes the registry update. Returns a
 * JSON-serializable response. No HTTP, no logging — those live in the route.
 *
 * Fail-quiet: invalid input never throws. Bad source / missing fields produce
 * `{ok: false, reason}` so the hook subprocess sees a 200 and continues.
 */

import type {AgentEventKind} from '@vt/vt-daemon/agent-runtime/lifecycle'
import {mapHookEvent, type HookSource} from './hookEventMapping'

export type HookHandlerInput = {
    readonly source: string
    readonly terminalId: string | undefined
    readonly hookEventName: string | undefined
}

export type HookHandlerResponse =
    | {readonly ok: true; readonly kind: AgentEventKind}
    | {readonly ok: true; readonly ignored: true; readonly eventName: string}
    | {readonly ok: false; readonly reason: 'unknown_source' | 'missing_terminal_or_event'}

export type HookHandlerDeps = {
    readonly updateAgentEvent: (terminalId: string, kind: AgentEventKind) => void
}

/**
 * Resolve the hook event name from either the JSON body (canonical Claude
 * Code / Codex payload shape) or the `?event=<Name>` query param (our
 * injectors bake it in so the endpoint still works if Express's body parser
 * silently drops a payload that lacks application/json Content-Type).
 */
export function resolveHookEventName(
    body: Record<string, unknown> | undefined,
    query: Record<string, unknown> | undefined,
): string | undefined {
    const fromBody: string | undefined = body && typeof body.hook_event_name === 'string' ? body.hook_event_name : undefined
    const fromQuery: string | undefined = query && typeof query.event === 'string' ? query.event : undefined
    return fromBody ?? fromQuery
}

function isSupportedSource(source: string): source is HookSource {
    return source === 'claude-code' || source === 'codex'
}

export function handleHookEventRequest(
    input: HookHandlerInput,
    deps: HookHandlerDeps,
): HookHandlerResponse {
    if (!isSupportedSource(input.source)) {
        return {ok: false, reason: 'unknown_source'}
    }
    if (!input.terminalId || !input.hookEventName) {
        return {ok: false, reason: 'missing_terminal_or_event'}
    }
    const kind: AgentEventKind | null = mapHookEvent(input.source, input.hookEventName)
    if (!kind) {
        return {ok: true, ignored: true, eventName: input.hookEventName}
    }
    deps.updateAgentEvent(input.terminalId, kind)
    return {ok: true, kind}
}
