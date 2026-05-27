/**
 * Command builder for resuming persisted Claude/Codex agent sessions.
 * Pure functions only — no I/O.
 */

import { type SupportedHeadlessCli } from './headlessCli'

export type ResumeMode = 'interactive' | 'headless'

export type ResumeCommandRequest = {
    readonly cliType: SupportedHeadlessCli | null
    readonly nativeSessionId: string
    readonly mode: ResumeMode
    readonly originalCommand: string
}

export type ResumeCommandResult =
    | { readonly kind: 'supported'; readonly command: string }
    | { readonly kind: 'unsupported'; readonly reason: 'no-cli-detected' | 'gemini-not-supported' | 'custom-cli-not-supported' | 'empty-session-id' }

// Shell-style `VAR=value` env-var assignments that prefix a command, e.g.
// `CLAUDE_CODE_NO_FLICKER=1 claude ...`.
const ENV_ASSIGNMENT_PREFIX_RE: RegExp = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/

function extractEnvPrefix(command: string): { prefix: string; rest: string } {
    const match: RegExpMatchArray | null = command.match(ENV_ASSIGNMENT_PREFIX_RE)
    if (match === null) return { prefix: '', rest: command }
    return { prefix: match[0], rest: command.slice(match[0].length) }
}

// Flags stripped from the original Claude command when building a resume
// command because they conflict with --resume or are prompt-specific.
// --continue and --resume/<id>/--session-id/<id> are replaced by the new
// --resume <nativeSessionId>. -p <arg> and prompt placeholders are
// execution-mode artefacts not applicable to a resumed session.
function extractClaudeResumeFlags(originalCommand: string): string {
    const { rest } = extractEnvPrefix(originalCommand)
    const withoutBinary: string = rest.replace(/^claude\s*/, '')
    const tokens: string[] = withoutBinary.split(/\s+/).filter(Boolean)
    const kept: string[] = []
    let i: number = 0
    while (i < tokens.length) {
        const token: string = tokens[i]!
        if (token === '--continue') {
            i += 1
        } else if (token === '--resume' || token === '--session-id' || token === '-p') {
            i += 2 // skip flag + its argument
        } else if (token === '"$AGENT_PROMPT"' || token === "'$AGENT_PROMPT'") {
            i += 1
        } else {
            kept.push(token)
            i += 1
        }
    }
    return kept.join(' ')
}

// Matches Codex hook flags: `-c 'hooks.Event=[...]'` (single-quoted),
// `-c "hooks.Event=[...]"` (double-quoted), or `-c hooks.Event=value` (unquoted).
const CODEX_HOOK_FLAG_RE: RegExp = /-c\s+(?:'hooks\.[^']*'|"hooks\.[^"]*"|hooks\.\S+)/g

function extractCodexHookFlags(command: string): string {
    const matches: RegExpMatchArray | null = command.match(CODEX_HOOK_FLAG_RE)
    if (matches === null) return ''
    return matches.join(' ')
}

/**
 * Build a CLI-native exact-session resume command from a pre-detected CLI type
 * and a native session id. The original command is used only to extract flags
 * worth preserving (env prefix, permission flags, hook flags).
 *
 * Callers obtain `cliType` by calling `detectCliType` from `headlessCli.ts`.
 * This function is pure: no I/O, no randomness.
 */
export function buildResumeCommand(req: ResumeCommandRequest): ResumeCommandResult {
    const { cliType, nativeSessionId, mode, originalCommand } = req

    if (nativeSessionId.trim() === '') {
        return { kind: 'unsupported', reason: 'empty-session-id' }
    }

    if (cliType === null) {
        return { kind: 'unsupported', reason: 'no-cli-detected' }
    }

    if (cliType === 'gemini') {
        return { kind: 'unsupported', reason: 'gemini-not-supported' }
    }

    if (cliType === 'claude') {
        const { prefix } = extractEnvPrefix(originalCommand)
        const extraFlags: string = extractClaudeResumeFlags(originalCommand)
        const flagsPart: string = extraFlags ? ` ${extraFlags}` : ''
        return {
            kind: 'supported',
            command: `${prefix}claude --resume ${nativeSessionId}${flagsPart}`,
        }
    }

    // cliType === 'codex'
    const hookFlags: string = extractCodexHookFlags(originalCommand)
    const hookPart: string = hookFlags ? ` ${hookFlags}` : ''
    if (mode === 'interactive') {
        return {
            kind: 'supported',
            command: `codex resume ${nativeSessionId}${hookPart}`,
        }
    }
    return {
        kind: 'supported',
        command: `codex exec resume ${nativeSessionId}${hookPart}`,
    }
}
