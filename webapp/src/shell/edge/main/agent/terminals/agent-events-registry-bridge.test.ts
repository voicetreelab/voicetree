/**
 * Black-box test for the SSE→registry bridge. The bridge's contract:
 *  - Frames with a `handlerResult: {ok: true, kind}` push `kind` into the
 *    in-process registry via `updateTerminalAgentEvent`.
 *  - Frames with `{ok: true, ignored: true}` are dropped.
 *  - Frames with `{ok: false, ...}` are dropped.
 *  - Frames with non-conforming handlerResult shapes are dropped.
 *
 * We assert on the bridge's return value (boolean signalling "did this
 * envelope drive a registry update") rather than mutating the real
 * registry — the registry's own subscriber-fan-out is already covered by
 * its own test suite.
 */

import {describe, expect, it} from 'vitest'

import {forwardAgentEventToRegistry} from './agent-events-registry-bridge'
import type {AgentEventEnvelope} from '@/shell/edge/main/runtime/electron/daemon/sync/agent-events-sse-subscription'

function envelopeWith(handlerResult: unknown, terminalId: string = 'T1'): AgentEventEnvelope {
    return {
        kind: 'agent-events',
        seq: 1,
        event: 'Stop',
        data: {
            terminalId,
            source: 'claude-code',
            at: Date.now(),
            handlerResult,
        },
        vault: '/v',
    }
}

describe('forwardAgentEventToRegistry', (): void => {
    it('returns true when handlerResult is {ok:true, kind:"done"}', (): void => {
        // Terminal id is intentionally unknown to the in-process registry —
        // `updateTerminalAgentEvent` is a no-op for unknown terminals,
        // so the side effect is invisible. The bridge still reports it
        // attempted to forward (boolean return).
        expect(forwardAgentEventToRegistry(envelopeWith({ok: true, kind: 'done'}))).toBe(true)
        expect(forwardAgentEventToRegistry(envelopeWith({ok: true, kind: 'awaiting'}))).toBe(true)
        expect(forwardAgentEventToRegistry(envelopeWith({ok: true, kind: 'working'}))).toBe(true)
    })

    it('returns false on {ok:true, ignored:true}', (): void => {
        expect(forwardAgentEventToRegistry(
            envelopeWith({ok: true, ignored: true, eventName: 'PreToolUse'}),
        )).toBe(false)
    })

    it('returns false on {ok:false, reason}', (): void => {
        expect(forwardAgentEventToRegistry(
            envelopeWith({ok: false, reason: 'unknown_source'}),
        )).toBe(false)
    })

    it('returns false when handlerResult is not a recognisable shape', (): void => {
        expect(forwardAgentEventToRegistry(envelopeWith(null))).toBe(false)
        expect(forwardAgentEventToRegistry(envelopeWith('a string'))).toBe(false)
        expect(forwardAgentEventToRegistry(envelopeWith(42))).toBe(false)
        expect(forwardAgentEventToRegistry(envelopeWith({}))).toBe(false)
        expect(forwardAgentEventToRegistry(envelopeWith({ok: 'truthy-but-not-bool'}))).toBe(false)
    })
})
