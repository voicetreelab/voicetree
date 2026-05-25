import {describe, expect, it} from 'vitest'
import {
    buildQuitTmuxSessionPromptModel,
    cleanupPolicyForQuitTmuxDecision,
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

    it('builds a native dialog model that maps buttons to cleanup decisions', () => {
        const model = buildQuitTmuxSessionPromptModel([
            {
                terminalId: 'Ben',
                name: 'Architecture task',
                agentName: 'Claude Sonnet',
                mode: 'interactive',
            },
        ])

        expect(model.message).toBe('Keep tmux running in the background?')
        expect(model.detail).toContain('Name: Architecture task | Agent: Claude Sonnet | Mode: interactive')
        expect(model.buttons).toEqual(['Keep Running', 'Stop Sessions', 'Cancel Quit'])
        expect(model.choices).toEqual(['preserve', 'terminate', 'cancel'])
        expect(cleanupPolicyForQuitTmuxDecision(model.choices[0])).toEqual({tmuxSessions: 'preserve'})
        expect(cleanupPolicyForQuitTmuxDecision(model.choices[1])).toEqual({tmuxSessions: 'terminate'})
        expect(cleanupPolicyForQuitTmuxDecision(model.choices[2])).toBeNull()
    })
})
