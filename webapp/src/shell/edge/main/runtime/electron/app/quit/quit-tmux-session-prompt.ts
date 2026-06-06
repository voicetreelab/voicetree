import {agentBaseName} from '@vt/graph-model/settings'

export type QuitTerminalRecord = {
    readonly terminalId: string
    readonly status: 'running' | 'exited'
    readonly terminalData: {
        readonly isHeadless: boolean
        readonly title: string
    }
}

export type QuitTmuxSessionDecision = 'quit' | 'cancel'

export type QuitTmuxSessionSummary = {
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
            mode: record.terminalData.isHeadless ? 'headless' : 'interactive',
            name: fallbackText(record.terminalData.title, record.terminalId),
            terminalId: record.terminalId,
        }))
}

export function formatQuitTmuxSessionDetails(sessions: readonly QuitTmuxSessionSummary[]): string {
    const sessionLines: readonly string[] = sessions.map(
        (session: QuitTmuxSessionSummary, index: number): string =>
            `${index + 1}. Name: ${session.name} | Agent: ${agentBaseName(session.terminalId)} | Mode: ${session.mode}`,
    )
    return [
        'Active tmux sessions:',
        ...sessionLines,
        '',
        'Running agents will stay available for reattachment after Voicetree quits.',
    ].join('\n')
}

export function buildQuitTmuxSessionPromptModel(sessions: readonly QuitTmuxSessionSummary[]): QuitTmuxSessionPromptModel {
    return {
        type: 'question',
        title: 'Quit with active tmux sessions?',
        message: 'Quit Voicetree?',
        detail: formatQuitTmuxSessionDetails(sessions),
        buttons: ['Quit', 'Cancel Quit'],
        choices: ['quit', 'cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
    }
}
