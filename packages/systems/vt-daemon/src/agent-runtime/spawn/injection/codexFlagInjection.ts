/**
 * Pure command-string transformations applied to a spawned agent's CLI
 * invocation. No I/O — just string → string.
 *
 * Currently only the Codex project-doc disable flag: VoiceTree already supplies
 * the task/context prompt for spawned Codex sessions, so Codex's native
 * AGENTS.md project-doc injection would surface the same repo instructions
 * twice in the model context.
 *
 * (Agent status reporting is no longer injected here — status is declared by
 * the agent itself via `create_graph`; see `updateTerminalStatus`.)
 */

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
 * VoiceTree already supplies the task/context prompt for spawned Codex
 * sessions. Disable Codex's native AGENTS.md project-doc injection so the
 * same repo instructions are not surfaced twice in the model context.
 *
 * Idempotent: no-op if `project_doc_max_bytes` is already set.
 */
export function injectCodexProjectDocDisableFlag(command: string): string {
    if (detectAgentCli(command) !== 'codex') return command
    if (/(^|\s)-c\s+["']?project_doc_max_bytes=/.test(command)) return command
    return insertAfterToken(command, 'codex', '-c project_doc_max_bytes=0')
}
