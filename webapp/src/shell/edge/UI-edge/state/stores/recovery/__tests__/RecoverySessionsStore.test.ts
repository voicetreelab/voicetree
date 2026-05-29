// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {RecoverableAgentSession, TerminalData} from '@vt/vt-daemon-client'
import {
    attachRecoverySession,
    clearRecoverySessions,
    getRecoverySessions,
    killRecoverySession,
    refreshRecoverySessions,
    resumeRecoverySession,
    startRecoverySessionsPolling,
    stopRecoverySessionsPolling,
    subscribeToRecoverySessions,
    syncRecoverySessionsFromMain,
} from '@/shell/edge/UI-edge/state/stores/recovery/RecoverySessionsStore'

type MockMainApi = {
    readonly refreshRecoverySessions: ReturnType<typeof vi.fn>
    readonly attachUnclaimedTmuxSession: ReturnType<typeof vi.fn>
    readonly killUnclaimedTmuxSession: ReturnType<typeof vi.fn>
    readonly resumeRecoverySession: ReturnType<typeof vi.fn>
}

function makeResumable(): RecoverableAgentSession {
    const terminalData: TerminalData = {
        type: 'Terminal',
        terminalId: 'Bob' as TerminalData['terminalId'],
        attachedToContextNodeId: '/project/ctx.md' as TerminalData['attachedToContextNodeId'],
        terminalCount: 0,
        anchoredToNodeId: O.none,
        title: 'Bob',
        resizable: true,
        shadowNodeDimensions: {width: 395, height: 380},
        isPinned: true,
        isDone: false,
        lifecycle: 'idle',
        lastOutputTime: 0,
        activityCount: 0,
        parentTerminalId: null,
        agentName: 'Bob',
        worktreeName: undefined,
        isHeadless: false,
        isMinimized: false,
        contextContent: '',
        agentTypeName: '',
        initialCommand: 'claude',
        initialEnvVars: {VOICETREE_PROJECT_PATH: '/project'},
    }
    return {
        terminalId: 'Bob' as TerminalData['terminalId'],
        agentName: 'Bob',
        metadataPath: '/project/.voicetree/terminals/Bob.json',
        terminalData,
        isClaimed: false,
        status: 'running',
        resume: {cliType: 'claude'},
    }
}

function installElectronApi(): MockMainApi {
    const main: MockMainApi = {
        refreshRecoverySessions: vi.fn().mockResolvedValue([]),
        attachUnclaimedTmuxSession: vi.fn().mockResolvedValue({success: true}),
        killUnclaimedTmuxSession: vi.fn().mockResolvedValue({success: true}),
        resumeRecoverySession: vi.fn().mockResolvedValue({success: true, terminalId: 'Bob'}),
    }
    Object.defineProperty(window, 'electronAPI', {
        configurable: true,
        value: {main},
    })
    return main
}

describe('RecoverySessionsStore', () => {
    let main: MockMainApi

    beforeEach(() => {
        main = installElectronApi()
        clearRecoverySessions()
    })

    afterEach(() => {
        stopRecoverySessionsPolling()
        clearRecoverySessions()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('syncs pushed recovery sessions and notifies subscribers', () => {
        const recovery: RecoverableAgentSession = makeResumable()
        let observed: readonly RecoverableAgentSession[] = []

        const unsubscribe = subscribeToRecoverySessions((rows) => {
            observed = rows
        })

        syncRecoverySessionsFromMain([recovery])

        expect(getRecoverySessions()).toEqual([recovery])
        expect(observed).toEqual([recovery])

        unsubscribe()
    })

    it('refreshes through the main refresh API and updates local state', async () => {
        const recovery: RecoverableAgentSession = makeResumable()
        main.refreshRecoverySessions.mockResolvedValue([recovery])

        await refreshRecoverySessions()

        expect(getRecoverySessions()).toEqual([recovery])
    })

    it('keeps a row visible after a failed resume so the user can see the error', async () => {
        const recovery: RecoverableAgentSession = makeResumable()
        syncRecoverySessionsFromMain([recovery])
        main.refreshRecoverySessions.mockResolvedValue([recovery])  // server-side: still resumable
        main.resumeRecoverySession.mockResolvedValue({success: false, terminalId: 'Bob', error: 'spawn refused'})

        const result = await resumeRecoverySession('Bob')

        expect(result.success).toBe(false)
        expect(result.error).toBe('spawn refused')
        expect(getRecoverySessions()).toEqual([recovery])
    })

    it('removes a row after a successful resume because main refresh returns the empty list', async () => {
        const recovery: RecoverableAgentSession = makeResumable()
        syncRecoverySessionsFromMain([recovery])
        main.refreshRecoverySessions.mockResolvedValue([])

        const result = await resumeRecoverySession('Bob')

        expect(result.success).toBe(true)
        // Resume triggers a refresh; the refresh promise resolved synchronously above.
        // Wait one microtask for the void Promise inside the store to settle.
        await Promise.resolve()
        await Promise.resolve()
        expect(getRecoverySessions()).toEqual([])
    })

    it('routes attach actions through the attach IPC and then refreshes', async () => {
        const recovery: RecoverableAgentSession = makeResumable()
        syncRecoverySessionsFromMain([recovery])
        main.refreshRecoverySessions.mockResolvedValue([])

        const result = await attachRecoverySession('vt-aaaaaaaaaa-Foo')

        expect(result.success).toBe(true)
        expect(main.attachUnclaimedTmuxSession).toHaveBeenCalledWith('vt-aaaaaaaaaa-Foo')
    })

    it('routes kill actions through the kill IPC and then refreshes', async () => {
        await killRecoverySession('vt-aaaaaaaaaa-Foo')
        expect(main.killUnclaimedTmuxSession).toHaveBeenCalledWith('vt-aaaaaaaaaa-Foo')
    })

    it('refreshes once when lifecycle starts and does not allocate renderer polling', () => {
        vi.useFakeTimers()

        startRecoverySessionsPolling()
        expect(main.refreshRecoverySessions).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(10_000)
        expect(main.refreshRecoverySessions).toHaveBeenCalledTimes(1)

        stopRecoverySessionsPolling()
        vi.advanceTimersByTime(10_000)
        expect(main.refreshRecoverySessions).toHaveBeenCalledTimes(1)
    })
})
