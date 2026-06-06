import {describe, expect, it} from 'vitest'
import {
    buildQuitTmuxSessionPromptModel,
    getActiveTmuxSessionSummaries,
} from './quit-tmux-session-prompt'

describe('quit tmux session prompt', () => {
    it('lists only running terminal sessions with names and agent names', () => {
        const summaries = getActiveTmuxSessionSummaries([
            {
                terminalId: 'Ben',
                status: 'running',
                terminalData: {title: 'Architecture task', agentName: 'Claude Sonnet', isHeadless: false},
            },
            {
                terminalId: 'Cho',
                status: 'exited',
                terminalData: {title: 'Completed task', agentName: 'Codex', isHeadless: true},
            },
            {
                terminalId: 'Dae',
                status: 'running',
                terminalData: {title: '', agentName: '', isHeadless: true},
            },
        ])

        expect(summaries).toEqual([
            {
                terminalId: 'Ben',
                name: 'Architecture task',
                agentName: 'Claude Sonnet',
                mode: 'interactive',
            },
            {
                terminalId: 'Dae',
                name: 'Dae',
                agentName: '(unknown)',
                mode: 'headless',
            },
        ])
    })

    it('builds a native dialog model that preserves an accidental-quit escape hatch', () => {
        const model = buildQuitTmuxSessionPromptModel([
            {
                terminalId: 'Ben',
                name: 'Architecture task',
                agentName: 'Claude Sonnet',
                mode: 'interactive',
            },
        ])

        expect(model.message).toBe('Quit Voicetree?')
        expect(model.detail).toContain('Name: Architecture task | Agent: Claude Sonnet | Mode: interactive')
        expect(model.detail).toContain('Running agents will stay available for reattachment after Voicetree quits.')
        expect(model.buttons).toEqual(['Quit', 'Cancel Quit'])
        expect(model.choices).toEqual(['quit', 'cancel'])
        expect(model.defaultId).toBe(0)
        expect(model.cancelId).toBe(1)
    })
})
