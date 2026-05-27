/**
 * Black-box tests for the hook-event → AgentEventKind mapping.
 *
 * Inputs are the event names that Claude Code and Codex actually emit
 * (per their hook docs). Outputs are the uniform AgentEventKind the
 * registry consumes, or null for events we deliberately ignore.
 */

import {describe, it, expect} from 'vitest'
import {mapHookEvent, mapClaudeCodeHookEvent, mapCodexHookEvent} from './hookEventMapping'

describe('mapClaudeCodeHookEvent', () => {
    it('Notification → awaiting (permission prompt or idle reminder)', () => {
        expect(mapClaudeCodeHookEvent('Notification')).toBe('awaiting')
    })

    it('Stop → awaiting (turn ended, agent now blocked on user)', () => {
        expect(mapClaudeCodeHookEvent('Stop')).toBe('awaiting')
    })

    it('UserPromptSubmit → working (user typed, agent now generating)', () => {
        expect(mapClaudeCodeHookEvent('UserPromptSubmit')).toBe('working')
    })

    it('PreToolUse → awaiting (only hooked for AskUserQuestion via matcher)', () => {
        expect(mapClaudeCodeHookEvent('PreToolUse')).toBe('awaiting')
    })

    it('PostToolUse → working (user answered AskUserQuestion, agent resumed)', () => {
        expect(mapClaudeCodeHookEvent('PostToolUse')).toBe('working')
    })

    it('SessionStart → null (not lifecycle-meaningful)', () => {
        expect(mapClaudeCodeHookEvent('SessionStart')).toBeNull()
    })

    it('unknown event name → null', () => {
        expect(mapClaudeCodeHookEvent('GarbledEvent')).toBeNull()
        expect(mapClaudeCodeHookEvent('')).toBeNull()
    })
})

describe('mapCodexHookEvent', () => {
    it('Stop → awaiting', () => {
        expect(mapCodexHookEvent('Stop')).toBe('awaiting')
    })

    it('PermissionRequest → awaiting', () => {
        expect(mapCodexHookEvent('PermissionRequest')).toBe('awaiting')
    })

    it('UserPromptSubmit → working', () => {
        expect(mapCodexHookEvent('UserPromptSubmit')).toBe('working')
    })

    it('unknown event name → null', () => {
        expect(mapCodexHookEvent('Notification')).toBeNull()
        expect(mapCodexHookEvent('SessionStart')).toBeNull()
    })
})

describe('mapHookEvent (dispatch by source)', () => {
    it('routes to the right per-source mapper', () => {
        expect(mapHookEvent('claude-code', 'Notification')).toBe('awaiting')
        expect(mapHookEvent('codex', 'Notification')).toBeNull()
        expect(mapHookEvent('codex', 'PermissionRequest')).toBe('awaiting')
        expect(mapHookEvent('claude-code', 'PermissionRequest')).toBeNull()
    })
})
