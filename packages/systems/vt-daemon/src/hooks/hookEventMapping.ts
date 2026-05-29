/**
 * Pure mapping from agent-hook event names to lifecycle AgentEventKind.
 *
 * Each supported agent (Claude Code, Codex) ships hooks that fire JSON payloads
 * with an event-name field. This module converts those event names into the
 * uniform lifecycle signal that the registry consumes.
 *
 * Unknown / uninteresting event names map to null — the endpoint skips them.
 */

import type {AgentEventKind} from '@vt/vt-daemon/agent-runtime/lifecycle'

export type HookSource = 'claude-code' | 'codex'

export function mapClaudeCodeHookEvent(eventName: string): AgentEventKind | null {
    switch (eventName) {
        // Claude Code fires Notification when permission is needed or the agent
        // is idle waiting on the user. Both block on the user → awaiting.
        case 'Notification':
            return 'awaiting'
        // Stop fires at the end of every assistant turn. Agent has finished
        // generating; user must type to continue → awaiting.
        case 'Stop':
            return 'awaiting'
        // PreToolUse fires before a tool runs. We only hook AskUserQuestion
        // (via matcher in the settings JSON), so receiving this event means
        // the agent is about to block on user input → awaiting.
        case 'PreToolUse':
            return 'awaiting'
        // User just submitted a prompt. Agent is now generating → working.
        case 'UserPromptSubmit':
            return 'working'
        // PostToolUse fires after a tool completes. We only hook
        // AskUserQuestion, so this means the user answered and the agent
        // resumed generating → working.
        case 'PostToolUse':
            return 'working'
        default:
            return null
    }
}

export function mapCodexHookEvent(eventName: string): AgentEventKind | null {
    switch (eventName) {
        case 'Stop':
            return 'awaiting'
        case 'PermissionRequest':
            return 'awaiting'
        case 'UserPromptSubmit':
            return 'working'
        default:
            return null
    }
}

export function mapHookEvent(source: HookSource, eventName: string): AgentEventKind | null {
    switch (source) {
        case 'claude-code':
            return mapClaudeCodeHookEvent(eventName)
        case 'codex':
            return mapCodexHookEvent(eventName)
    }
}
