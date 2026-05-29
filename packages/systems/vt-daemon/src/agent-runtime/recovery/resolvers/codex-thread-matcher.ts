export type CodexThreadRow = {
    readonly id: string
    readonly first_user_message?: string
    readonly cwd?: string
    readonly created_at_ms?: number
    readonly updated_at_ms?: number
    readonly rollout_path?: string
}

export type CodexMatchInput = {
    readonly rows: readonly CodexThreadRow[]
    readonly terminalId: string
    readonly projectRoot: string
    readonly taskNodePath: string
}

function rowMatchesMarkers(
    row: CodexThreadRow,
    terminalId: string,
    projectRoot: string,
    taskNodePath: string,
): boolean {
    const firstUserMessage: string | undefined = row.first_user_message
    if (typeof firstUserMessage !== 'string' || !firstUserMessage) return false
    return firstUserMessage.includes(`VOICETREE_TERMINAL_ID = ${terminalId}`)
        && firstUserMessage.includes(`VOICETREE_PROJECT_PATH = ${projectRoot}`)
        && firstUserMessage.includes(`TASK_NODE_PATH = ${taskNodePath}`)
}

/**
 * Pure first-match resolver for Codex `threads` rows.
 *
 * Returns the `id` of the first row whose `first_user_message` contains
 * all three VoiceTree markers. Returns null when no row matches or the
 * matching row has no id. Recency filtering is the caller's responsibility;
 * this matcher only enforces the marker conjunction.
 */
export function matchCodexThreadId(input: CodexMatchInput): string | null {
    for (const row of input.rows) {
        if (!row || typeof row !== 'object') continue
        if (!rowMatchesMarkers(row, input.terminalId, input.projectRoot, input.taskNodePath)) continue
        if (typeof row.id === 'string' && row.id.length > 0) return row.id
    }
    return null
}
