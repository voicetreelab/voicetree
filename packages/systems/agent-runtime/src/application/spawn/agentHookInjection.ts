/**
 * Pure command-string transformations that inject VoiceTree lifecycle hooks
 * into a spawned agent's CLI invocation. No I/O — `ensureClaudeHookSettingsFile`
 * (edge) writes the JSON; this module just produces strings.
 *
 * Claude Code path: insert `--settings <vt-managed-json>` right after the
 *   `claude` token. The JSON file (written by the edge helper) merges with
 *   the user's existing config and only adds VoiceTree's hook commands.
 *
 * Codex path: insert `-c hooks.<Event>=...` flags right after the `codex`
 *   token. The TOML inline-table value bakes in mcpPort + terminalId at spawn
 *   time (no shell-var expansion needed), and is wrapped in single quotes at
 *   the shell level so embedded TOML basic-string escapes reach Codex's parser
 *   unmodified.
 */

import {shellQuote} from '../util/shellQuote'

export type AgentCli = 'claude' | 'codex' | 'other'

/**
 * Identify the agent binary in a command string. Skips leading `VAR=value`
 * shell-style env-var assignments (the default Claude entry uses
 * `CLAUDE_CODE_NO_FLICKER=1 claude ...`).
 */
export function detectAgentCli(command: string): AgentCli {
    const tokens: string[] = command.trim().split(/\s+/)
    let i: number = 0
    while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
        i++
    }
    const bin: string | undefined = tokens[i]
    if (bin === 'claude') return 'claude'
    if (bin === 'codex') return 'codex'
    return 'other'
}

/**
 * Insert `additionalArgs` immediately after `targetToken` in the command
 * string. Whitespace-preserving (uses the first match only). If the token
 * isn't found, returns the command unchanged.
 */
function insertAfterToken(command: string, targetToken: string, additionalArgs: string): string {
    // Match `targetToken` only when surrounded by whitespace or string boundary
    // so we don't catch substrings like `claude-code` or `--claude`.
    const re: RegExp = new RegExp(`(^|\\s)${targetToken}(\\s|$)`)
    const match: RegExpExecArray | null = re.exec(command)
    if (!match) return command
    const insertAt: number = match.index + match[1].length + targetToken.length
    return command.slice(0, insertAt) + ` ${additionalArgs}` + command.slice(insertAt)
}

/**
 * If the command launches `claude`, inject `--settings <settingsPath>`
 * right after the `claude` token. Otherwise return the command unchanged.
 *
 * Idempotent: if `--settings` is already in the command (anywhere), this
 * is a no-op so users who configured their own --settings aren't clobbered.
 */
export function injectClaudeSettingsFlag(command: string, settingsPath: string): string {
    if (detectAgentCli(command) !== 'claude') return command
    if (/(^|\s)--settings(\s|=)/.test(command)) return command
    return insertAfterToken(command, 'claude', `--settings ${shellQuote(settingsPath)}`)
}

function tomlBasicString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function codexCommandHook(command: string, options: {timeout?: number; statusMessage?: string} = {}): string {
    const fields: string[] = [
        'type="command"',
        `command=${tomlBasicString(command)}`,
    ]
    if (options.timeout !== undefined) {
        fields.push(`timeout=${options.timeout}`)
    }
    if (options.statusMessage !== undefined) {
        fields.push(`statusMessage=${tomlBasicString(options.statusMessage)}`)
    }
    return `{${fields.join(',')}}`
}

function codexMatcherGroup(
    hooks: readonly string[],
    options: {matcher?: string} = {},
): string {
    const fields: string[] = []
    if (options.matcher !== undefined) {
        fields.push(`matcher=${tomlBasicString(options.matcher)}`)
    }
    fields.push(`hooks=[${hooks.join(',')}]`)
    return `{${fields.join(',')}}`
}

function buildCodexRelayCommand(mcpPort: number, terminalId: string, event: string): string {
    const url: string = `http://localhost:${mcpPort}/hook/codex?terminal=${encodeURIComponent(terminalId)}&event=${event}`
    return (
        `curl -fsS -X POST -H "Content-Type: application/json" --max-time 2 --data-binary @- "${url}" ` +
        '>/dev/null 2>&1 || true'
    )
}

/**
 * Build Codex `-c hooks.<Event>=...` flags as a single space-joined
 * shell string. Each flag's TOML inline-table value is wrapped in single
 * quotes at the shell level — inside, TOML basic-string `\"` escapes reach
 * Codex's parser unmodified. The mcpPort + terminalId are baked in at spawn
 * time (no shell-var expansion needed, no per-fire ambiguity).
 *
 * Caller is responsible for placing this string immediately after the
 * `codex` token (see `injectCodexHookFlags`).
 */
export function buildCodexHookFlags(mcpPort: number, terminalId: string): string {
    const relayEvents: readonly string[] = ['Stop', 'PermissionRequest', 'UserPromptSubmit']
    const relayFlags: string[] = relayEvents.map(event => {
        const group: string = codexMatcherGroup([
            codexCommandHook(buildCodexRelayCommand(mcpPort, terminalId, event)),
        ])
        return `-c 'hooks.${event}=[${group}]'`
    })

    const postToolUseRelay: string = codexMatcherGroup([
        codexCommandHook(buildCodexRelayCommand(mcpPort, terminalId, 'PostToolUse')),
    ], {matcher: 'AskUserQuestion'})
    const fileSizeCheck: string = codexMatcherGroup([
        codexCommandHook('node "$(git rev-parse --show-toplevel)/webapp/.claude/hooks/file-size-check.cjs"', {
            timeout: 30,
            statusMessage: 'Checking edited file sizes',
        }),
    ], {matcher: '^(apply_patch|Edit|Write|MultiEdit)$'})

    return [
        ...relayFlags,
        `-c 'hooks.PostToolUse=[${postToolUseRelay},${fileSizeCheck}]'`,
    ].join(' ')
}

/**
 * If the command launches `codex`, inject the three hook flags right after
 * the `codex` token. Idempotent: no-op if `-c hooks.` is already present.
 */
export function injectCodexHookFlags(command: string, mcpPort: number, terminalId: string): string {
    if (detectAgentCli(command) !== 'codex') return command
    if (/(^|\s)-c\s+["']?hooks\./.test(command)) return command
    return insertAfterToken(command, 'codex', buildCodexHookFlags(mcpPort, terminalId))
}

/**
 * Returns the static JSON that VoiceTree writes to its app-support dir for
 * Claude Code to consume via `--settings`. Hook commands reference
 * `$VOICETREE_MCP_PORT` and `$VOICETREE_TERMINAL_ID` as shell variables —
 * those are injected into the spawned agent's env by buildTerminalEnvVars
 * and inherited by the hook subprocess.
 *
 * The curl call is fire-and-forget: 2-second timeout, errors silenced, exit
 * code clamped to 0 so a transient endpoint hiccup never blocks Claude Code.
 */
export function buildClaudeHookSettingsJson(): string {
    // Per-event hook command. Bakes the event name into the URL as
    // `?event=<Name>` so the endpoint works even when Claude's hook subprocess
    // sends the JSON payload without an application/json Content-Type — which
    // Express's body parser would otherwise silently drop. The header is set
    // explicitly too; the query param is defense-in-depth.
    const buildCurl = (event: string): string =>
        'curl -fsS -X POST -H "Content-Type: application/json" --max-time 2 --data-binary @- ' +
        `"http://localhost:\${VOICETREE_MCP_PORT}/hook/claude-code?terminal=\${VOICETREE_TERMINAL_ID}&event=${event}" ` +
        '>/dev/null 2>&1 || true'
    const entry = (event: string) => ({hooks: [{type: 'command', command: buildCurl(event)}]})
    const matchedEntry = (event: string, matcher: string) => ({matcher, ...entry(event)})
    const settings = {
        hooks: {
            Notification: [entry('Notification')],
            Stop: [entry('Stop')],
            UserPromptSubmit: [entry('UserPromptSubmit')],
            PreToolUse: [matchedEntry('PreToolUse', 'AskUserQuestion')],
            PostToolUse: [matchedEntry('PostToolUse', 'AskUserQuestion')],
        },
    }
    return JSON.stringify(settings, null, 2) + '\n'
}
