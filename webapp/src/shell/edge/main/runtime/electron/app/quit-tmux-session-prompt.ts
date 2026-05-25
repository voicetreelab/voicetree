export type QuitTerminalRecord = {
    readonly terminalId: string
    readonly status: 'running' | 'exited'
    readonly terminalData: {
        readonly agentName: string
        readonly isHeadless: boolean
        readonly title: string
    }
}

export type QuitTmuxCleanupPolicy = {
    readonly tmuxSessions: 'preserve' | 'terminate'
}

export type QuitTmuxSessionDecision = 'preserve' | 'terminate' | 'cancel'

export type QuitTmuxSessionSummary = {
    readonly agentName: string
    readonly mode: 'headless' | 'interactive'
    readonly name: string
    readonly terminalId: string
}

export type QuitTmuxSessionPromptModel = {
    readonly buttons: readonly string[]
    readonly cancelId: number
    readonly choices: readonly QuitTmuxSessionDecision[]
    readonly defaultId: number
    readonly detail: string
    readonly message: string
    readonly noLink: boolean
    readonly title: string
    readonly type: 'question'
}

function fallbackText(value: string, fallback: string): string {
    const trimmed: string = value.trim()
    return trimmed.length > 0 ? trimmed : fallback
}

export function getActiveTmuxSessionSummaries(records: readonly QuitTerminalRecord[]): readonly QuitTmuxSessionSummary[] {
    return records
        .filter((record: QuitTerminalRecord): boolean => record.status === 'running')
        .map((record: QuitTerminalRecord): QuitTmuxSessionSummary => ({
            agentName: fallbackText(record.terminalData.agentName, '(unknown)'),
            mode: record.terminalData.isHeadless ? 'headless' : 'interactive',
            name: fallbackText(record.terminalData.title, record.terminalId),
            terminalId: record.terminalId,
        }))
}

export function formatQuitTmuxSessionDetails(sessions: readonly QuitTmuxSessionSummary[]): string {
    const sessionLines: readonly string[] = sessions.map(
        (session: QuitTmuxSessionSummary, index: number): string =>
            `${index + 1}. Name: ${session.name} | Agent: ${session.agentName} | Mode: ${session.mode}`,
    )
    return [
        'Active tmux sessions:',
        ...sessionLines,
        '',
        'Keep them running so they can be reattached after restart, or stop them before quitting.',
    ].join('\n')
}

export function buildQuitTmuxSessionPromptModel(sessions: readonly QuitTmuxSessionSummary[]): QuitTmuxSessionPromptModel {
    return {
        type: 'question',
        title: 'Quit with active tmux sessions?',
        message: 'Keep tmux running in the background?',
        detail: formatQuitTmuxSessionDetails(sessions),
        buttons: ['Keep Running', 'Stop Sessions', 'Cancel Quit'],
        choices: ['preserve', 'terminate', 'cancel'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
    }
}

export function cleanupPolicyForQuitTmuxDecision(decision: QuitTmuxSessionDecision): QuitTmuxCleanupPolicy | null {
    if (decision === 'cancel') return null
    return {tmuxSessions: decision}
}
