/**
 * CLI-specific command shaping for headless agents.
 */

export type SupportedHeadlessCli = 'claude' | 'codex' | 'gemini'

// Shell-style `VAR=value` env-var assignments that prefix a command, e.g.
// `CLAUDE_CODE_NO_FLICKER=1 claude ...`. Values are non-space (quoted values
// with embedded whitespace are not used in agent templates).
const ENV_ASSIGNMENT_PREFIX_RE: RegExp = /^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/

function stripLeadingEnvAssignments(command: string): string {
    return command.replace(ENV_ASSIGNMENT_PREFIX_RE, '')
}

/**
 * Detect CLI type from the agent command string.
 * Used for CLI-specific headless command construction and stop gate resume.
 *
 * The default Claude template prefixes the binary with a shell env-var
 * assignment (`CLAUDE_CODE_NO_FLICKER=1 claude ...`); strip any such
 * leading `VAR=value` tokens before matching the CLI name so detection
 * survives env-prefixed templates.
 */
export function detectCliType(command: string): SupportedHeadlessCli | null {
    const tail: string = stripLeadingEnvAssignments(command)
    if (tail.startsWith('claude ') || tail === 'claude') return 'claude'
    if (tail.startsWith('codex ') || tail === 'codex') return 'codex'
    if (tail.startsWith('gemini ') || tail === 'gemini') return 'gemini'
    return null
}

function stripPromptPlaceholder(command: string): string {
    return command
        .replace('"$AGENT_PROMPT"', '')
        .replace("'$AGENT_PROMPT'", '')
        .replace(/\s+/g, ' ')
        .trim()
}

/**
 * Build the shell command for a headless agent from the interactive agent command.
 * Strips the interactive "$AGENT_PROMPT" positional arg, then re-adds per CLI convention.
 * No --session-id flag - CLI auto-generates one; resume uses --continue.
 *
 * Preserves any flags already in the input command (e.g. VoiceTree's injected
 * `-c hooks.<Event>=...` for Codex) by appending the headless-specific bits
 * rather than discarding the input.
 */
export function buildHeadlessCommand(command: string): string {
    const baseCommand: string = stripPromptPlaceholder(command)
    const cliType: SupportedHeadlessCli | null = detectCliType(baseCommand)
    if (cliType === 'codex') {
        // Codex headless requires `exec --full-auto`. If the input already
        // included exec (caller built a headless command manually), don't
        // duplicate; just re-attach the positional prompt.
        if (/(^|\s)exec(\s|$)/.test(baseCommand)) {
            return `${baseCommand} "$AGENT_PROMPT"`
        }
        return `${baseCommand} exec --full-auto "$AGENT_PROMPT"`
    }
    if (cliType === null) {
        return baseCommand
    }
    const promptArg: string = ' -p "$AGENT_PROMPT"'
    return `${baseCommand}${promptArg}`
}
