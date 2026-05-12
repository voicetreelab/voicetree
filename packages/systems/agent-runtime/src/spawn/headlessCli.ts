/**
 * CLI-specific command shaping for headless agents.
 */

export type SupportedHeadlessCli = 'claude' | 'codex' | 'gemini'

/**
 * Detect CLI type from the agent command string.
 * Used for CLI-specific headless command construction and stop gate resume.
 */
export function detectCliType(command: string): SupportedHeadlessCli | null {
    if (command.startsWith('claude ') || command === 'claude') return 'claude'
    if (command.startsWith('codex ') || command === 'codex') return 'codex'
    if (command.startsWith('gemini ') || command === 'gemini') return 'gemini'
    return null
}

/**
 * Build the shell command for a headless agent from the interactive agent command.
 * Strips the interactive "$AGENT_PROMPT" positional arg, then re-adds per CLI convention.
 * No --session-id flag - CLI auto-generates one; resume uses --continue.
 */
export function buildHeadlessCommand(command: string): string {
    const baseCommand: string = command.replace('"$AGENT_PROMPT"', '').replace("'$AGENT_PROMPT'", '').trim()
    const cliType: SupportedHeadlessCli | null = detectCliType(baseCommand)
    // Codex headless: `codex exec --full-auto "$AGENT_PROMPT"` (positional prompt, no TTY needed)
    if (cliType === 'codex') return `codex exec --full-auto "$AGENT_PROMPT"`
    const promptArg: string = ' -p "$AGENT_PROMPT"'
    return `${baseCommand}${promptArg}`
}
