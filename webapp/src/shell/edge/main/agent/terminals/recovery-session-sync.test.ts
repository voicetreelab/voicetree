import {beforeEach, describe, expect, it, vi} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {ForkAgentSessionResult, ResumePersistedResult, TerminalData, TerminalId} from '@vt/agent-runtime'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

const mocks = vi.hoisted(() => ({
    discoverRecoverableAgentSessions: vi.fn(),
    forkAgentSession: vi.fn(),
    resumePersistedAgentSession: vi.fn(),
    syncRecoverySessions: vi.fn(),
    uiLaunches: [] as Array<{
        readonly nodeId: string
        readonly terminalData: TerminalData
        readonly skipFitAnimation: boolean | undefined
    }>,
}))

vi.mock('@/shell/edge/main/agent/terminals/terminalRuntimeSurface', () => ({
    terminalRuntimeSurface: {
        discoverRecoverableAgentSessions: mocks.discoverRecoverableAgentSessions,
        forkAgentSession: mocks.forkAgentSession,
        resumePersistedAgentSession: mocks.resumePersistedAgentSession,
    },
}))

vi.mock('@/shell/edge/main/runtime/ui-api-proxy', () => ({
    uiAPI: {
        launchTerminalOntoUI: (
            nodeId: string,
            terminalData: TerminalData,
            skipFitAnimation?: boolean,
        ): void => {
            mocks.uiLaunches.push({nodeId, terminalData, skipFitAnimation})
        },
        syncRecoverySessions: mocks.syncRecoverySessions,
    },
}))

import {forkRecoverySession, resumeRecoverySession} from './recovery-session-sync'

function makeTerminalData(overrides: Partial<TerminalData> = {}): TerminalData {
    return {
        type: 'Terminal',
        terminalId: 'Mira' as TerminalId,
        attachedToContextNodeId: '/vault/readme.md' as NodeIdAndFilePath,
        terminalCount: 0,
        anchoredToNodeId: O.none,
        title: 'Mira',
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        initialEnvVars: {VOICETREE_TERMINAL_ID: 'Mira', VOICETREE_VAULT_PATH: '/vault'},
        initialCommand: 'claude',
        isPinned: true,
        isDone: false,
        lifecycle: 'idle',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: 'Mira',
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: '',
        ...overrides,
    }
}

describe('recovery-session-sync', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.uiLaunches.length = 0
        mocks.discoverRecoverableAgentSessions.mockResolvedValue([])
    })

    it('launches the resumed terminal onto its graph node after runtime resume succeeds', async () => {
        const terminalData: TerminalData = makeTerminalData()
        const spawned: ResumePersistedResult = {
            kind: 'spawned',
            pid: 1234,
            command: 'claude --resume session-id',
            terminalData,
        }
        mocks.resumePersistedAgentSession.mockResolvedValue(spawned)

        const result = await resumeRecoverySession('Mira')

        expect(result).toEqual({success: true, terminalId: 'Mira'})
        expect(mocks.uiLaunches).toEqual([
            {nodeId: '/vault/readme.md', terminalData, skipFitAnimation: false},
        ])
    })

    it('does not launch graph UI when runtime resume fails', async () => {
        const failed: ResumePersistedResult = {
            kind: 'spawn-failed',
            error: 'tmux refused spawn',
        }
        mocks.resumePersistedAgentSession.mockResolvedValue(failed)

        const result = await resumeRecoverySession('Mira')

        expect(result).toEqual({success: false, terminalId: 'Mira', error: 'tmux refused spawn'})
        expect(mocks.uiLaunches).toEqual([])
    })

    it('launches a forked recovered terminal onto the source graph node', async () => {
        const terminalData: TerminalData = makeTerminalData({
            terminalId: 'Mira 2' as TerminalId,
            agentName: 'Mira 2',
            title: 'Mira 2',
            parentTerminalId: 'Mira' as TerminalId,
        })
        const spawned: ForkAgentSessionResult = {
            kind: 'spawned',
            forkedTerminalId: 'Mira 2' as TerminalId,
            pid: 2345,
            command: 'claude --resume session-id',
            terminalData,
        }
        mocks.forkAgentSession.mockResolvedValue(spawned)

        const result = await forkRecoverySession('Mira')

        expect(result).toEqual({success: true, terminalId: 'Mira 2'})
        expect(mocks.uiLaunches).toEqual([
            {nodeId: '/vault/readme.md', terminalData, skipFitAnimation: false},
        ])
    })
})
