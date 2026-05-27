import {beforeEach, describe, expect, it, vi} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {ForkAgentSessionResult, ResumePersistedResult, TerminalData, TerminalId} from '@vt/agent-runtime'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'

const mocks = vi.hoisted(() => ({
    discoverRecoverableAgentSessions: vi.fn(),
    forkAgentSession: vi.fn(),
    resumePersistedAgentSession: vi.fn(),
    removePersistedAgentRecord: vi.fn(),
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
        removePersistedAgentRecord: mocks.removePersistedAgentRecord,
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

import {forkRecoverySession, removeRecoverySession, resumeRecoverySession} from './recovery-session-sync'

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

    it('propagates a structured no-native-session failure (with diagnosticSessionId) to the renderer', async () => {
        const missed: ResumePersistedResult = {
            kind: 'no-native-session',
            cliType: 'codex',
            reason: 'outside-recency-window',
            diagnosticSessionId: '019e651e-b53e-79a0-815a-f6247aca3724',
        }
        mocks.resumePersistedAgentSession.mockResolvedValue(missed)

        const result = await resumeRecoverySession('Mira')

        expect(result.success).toBe(false)
        expect(result.terminalId).toBe('Mira')
        expect(result.failure).toEqual({
            reason: 'outside-recency-window',
            cliType: 'codex',
            diagnosticSessionId: '019e651e-b53e-79a0-815a-f6247aca3724',
        })
        expect(mocks.uiLaunches).toEqual([])
    })

    it('propagates a no-native-session miss without diagnosticSessionId (e.g. db-missing)', async () => {
        const missed: ResumePersistedResult = {
            kind: 'no-native-session',
            cliType: 'codex',
            reason: 'db-missing',
        }
        mocks.resumePersistedAgentSession.mockResolvedValue(missed)

        const result = await resumeRecoverySession('Mira')

        expect(result.success).toBe(false)
        expect(result.failure).toEqual({reason: 'db-missing', cliType: 'codex'})
    })

    it('translates a successful removePersistedAgentRecord into {success: true} and refreshes', async () => {
        mocks.removePersistedAgentRecord.mockResolvedValue({kind: 'removed'})
        const result = await removeRecoverySession('Iris')
        expect(result).toEqual({success: true, terminalId: 'Iris'})
        expect(mocks.removePersistedAgentRecord).toHaveBeenCalledWith('Iris')
    })

    it('reports a live-registry refusal as a structured error string', async () => {
        mocks.removePersistedAgentRecord.mockResolvedValue({kind: 'refused', reason: 'live-registry-entry'})
        const result = await removeRecoverySession('Ama')
        expect(result.success).toBe(false)
        expect(result.error).toContain('live')
    })

    it('reports invalid-id with a generic message rather than leaking the input', async () => {
        mocks.removePersistedAgentRecord.mockResolvedValue({kind: 'invalid-id'})
        const result = await removeRecoverySession('../etc/passwd')
        expect(result.success).toBe(false)
        expect(result.error).toBe('Invalid terminal id')
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
