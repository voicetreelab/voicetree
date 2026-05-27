/**
 * Black-box tests for the hook-event request handler.
 *
 * Drives the real registry (no mocks) and asserts the lifecycle that
 * results from each kind of request. This is the integration seam between
 * an incoming HTTP hook payload and the terminal lifecycle.
 */

import {describe, it, expect, beforeEach} from 'vitest'
import {terminalRuntimeSurface as agentRuntime} from '../agent-runtime/agent-control/terminalRuntimeSurface.ts'
import {clearTerminalRecords, getTerminalRecords, recordTerminalSpawn} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import {createTerminalData} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import type {TerminalData, TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {handleHookEventRequest, resolveHookEventName} from './hookEventHandler'

function spawn(id: string, parentId: string | null = null): TerminalData {
    const data: TerminalData = createTerminalData({
        terminalId: id as TerminalId,
        attachedToNodeId: '/tmp/ctx.md' as NodeIdAndFilePath,
        terminalCount: 1,
        title: 'test',
        agentName: 'TestAgent',
        parentTerminalId: parentId as TerminalId | null,
    })
    recordTerminalSpawn(id, data)
    return data
}

function lifecycleOf(id: string): string {
    return getTerminalRecords().find(r => r.terminalId === id)?.terminalData.lifecycle ?? 'MISSING'
}

const deps = {updateAgentEvent: agentRuntime.updateTerminalAgentEvent}

describe('handleHookEventRequest — end-to-end against the real registry', () => {
    beforeEach(() => clearTerminalRecords())

    it('Claude Code Notification flips a leaf terminal to awaiting_input', () => {
        spawn('cc-1')
        const result = handleHookEventRequest(
            {source: 'claude-code', terminalId: 'cc-1', hookEventName: 'Notification'},
            deps,
        )
        expect(result).toEqual({ok: true, kind: 'awaiting'})
        expect(lifecycleOf('cc-1')).toBe('awaiting_input')
    })

    it('Claude Code Stop flips terminal to awaiting_input (turn end)', () => {
        spawn('cc-1')
        const result = handleHookEventRequest(
            {source: 'claude-code', terminalId: 'cc-1', hookEventName: 'Stop'},
            deps,
        )
        expect(result).toEqual({ok: true, kind: 'awaiting'})
        expect(lifecycleOf('cc-1')).toBe('awaiting_input')
    })

    it('Claude Code UserPromptSubmit flips terminal back to active', () => {
        spawn('cc-1')
        handleHookEventRequest({source: 'claude-code', terminalId: 'cc-1', hookEventName: 'Stop'}, deps)
        expect(lifecycleOf('cc-1')).toBe('awaiting_input')
        const result = handleHookEventRequest(
            {source: 'claude-code', terminalId: 'cc-1', hookEventName: 'UserPromptSubmit'},
            deps,
        )
        expect(result).toEqual({ok: true, kind: 'working'})
        expect(lifecycleOf('cc-1')).toBe('active')
    })

    it('Claude Code PreToolUse flips to awaiting_input for AskUserQuestion', () => {
        spawn('cc-1')
        handleHookEventRequest({source: 'claude-code', terminalId: 'cc-1', hookEventName: 'UserPromptSubmit'}, deps)
        const result = handleHookEventRequest(
            {source: 'claude-code', terminalId: 'cc-1', hookEventName: 'PreToolUse'},
            deps,
        )
        expect(result).toEqual({ok: true, kind: 'awaiting'})
        expect(lifecycleOf('cc-1')).toBe('awaiting_input')
    })

    it('Codex Stop also flips to awaiting_input', () => {
        spawn('codex-1')
        const result = handleHookEventRequest(
            {source: 'codex', terminalId: 'codex-1', hookEventName: 'Stop'},
            deps,
        )
        expect(result).toEqual({ok: true, kind: 'awaiting'})
        expect(lifecycleOf('codex-1')).toBe('awaiting_input')
    })

    it('Codex PermissionRequest → awaiting; Codex does not honour Notification', () => {
        spawn('codex-1')
        expect(handleHookEventRequest({source: 'codex', terminalId: 'codex-1', hookEventName: 'PermissionRequest'}, deps))
            .toEqual({ok: true, kind: 'awaiting'})
        expect(lifecycleOf('codex-1')).toBe('awaiting_input')

        handleHookEventRequest({source: 'codex', terminalId: 'codex-1', hookEventName: 'UserPromptSubmit'}, deps)
        expect(lifecycleOf('codex-1')).toBe('active')

        expect(handleHookEventRequest({source: 'codex', terminalId: 'codex-1', hookEventName: 'Notification'}, deps))
            .toEqual({ok: true, ignored: true, eventName: 'Notification'})
        expect(lifecycleOf('codex-1')).toBe('active')
    })

    it('orchestrator parent stays idle (not blue) when its hook fires awaiting', () => {
        spawn('parent-1')
        spawn('child-1', 'parent-1')
        const result = handleHookEventRequest(
            {source: 'claude-code', terminalId: 'parent-1', hookEventName: 'Stop'},
            deps,
        )
        expect(result).toEqual({ok: true, kind: 'awaiting'})
        expect(lifecycleOf('parent-1')).toBe('idle')
    })

    it('unknown source short-circuits with ok:false', () => {
        spawn('agent-1')
        const result = handleHookEventRequest(
            {source: 'aider', terminalId: 'agent-1', hookEventName: 'Notification'},
            deps,
        )
        expect(result).toEqual({ok: false, reason: 'unknown_source'})
        expect(lifecycleOf('agent-1')).toBe('spawning')
    })

    it('missing terminalId short-circuits with ok:false', () => {
        const result = handleHookEventRequest(
            {source: 'claude-code', terminalId: undefined, hookEventName: 'Stop'},
            deps,
        )
        expect(result).toEqual({ok: false, reason: 'missing_terminal_or_event'})
    })

    it('missing hookEventName short-circuits with ok:false', () => {
        spawn('cc-1')
        const result = handleHookEventRequest(
            {source: 'claude-code', terminalId: 'cc-1', hookEventName: undefined},
            deps,
        )
        expect(result).toEqual({ok: false, reason: 'missing_terminal_or_event'})
        expect(lifecycleOf('cc-1')).toBe('spawning')
    })

    it('hook for an unknown terminal is a no-op (registry handles, handler still ok)', () => {
        // A hook subprocess might fire after the terminal was reaped. The
        // registry silently drops the update; the handler still reports ok
        // because the routing was valid.
        const result = handleHookEventRequest(
            {source: 'claude-code', terminalId: 'ghost', hookEventName: 'Stop'},
            deps,
        )
        expect(result).toEqual({ok: true, kind: 'awaiting'})
    })
})

describe('resolveHookEventName', () => {
    it('prefers body.hook_event_name when both body and query provide one', () => {
        expect(resolveHookEventName({hook_event_name: 'Stop'}, {event: 'Notification'})).toBe('Stop')
    })

    it('falls back to query.event when body has no hook_event_name', () => {
        // Reproduces the production bug: Claude/Codex hooks POST without
        // explicit Content-Type, Express body parser silently drops payload,
        // so the query-param fallback is what keeps the path working.
        expect(resolveHookEventName({}, {event: 'Stop'})).toBe('Stop')
        expect(resolveHookEventName(undefined, {event: 'Stop'})).toBe('Stop')
    })

    it('returns undefined when neither source has an event name', () => {
        expect(resolveHookEventName({}, {})).toBeUndefined()
        expect(resolveHookEventName(undefined, undefined)).toBeUndefined()
    })

    it('ignores non-string values', () => {
        expect(resolveHookEventName({hook_event_name: 42 as unknown as string}, {})).toBeUndefined()
        expect(resolveHookEventName({}, {event: ['x'] as unknown as string})).toBeUndefined()
    })

    it('end-to-end: a hook POST without Content-Type still resolves via the query param', () => {
        // Simulates the express route's perspective: body parser dropped the
        // payload (so req.body is {}), query has ?event=Stop&terminal=cc-1.
        const eventName = resolveHookEventName({}, {event: 'Stop', terminal: 'cc-1'})
        expect(eventName).toBe('Stop')
    })
})
