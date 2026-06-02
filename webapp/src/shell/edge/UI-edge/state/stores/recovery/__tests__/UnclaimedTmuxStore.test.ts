// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {UnclaimedTmuxSession} from '@vt/vt-daemon-client'
import {
    attachUnclaimedTmuxSession,
    clearUnclaimedTmuxSessions,
    getUnclaimedTmuxSessions,
    killUnclaimedTmuxSession,
    refreshUnclaimedTmuxSessions,
    startUnclaimedTmuxPolling,
    stopUnclaimedTmuxPolling,
    subscribeToUnclaimedTmuxChanges,
    syncUnclaimedTmuxFromMain,
} from '@/shell/edge/UI-edge/state/stores/recovery/UnclaimedTmuxStore'

type MockMainApi = {
    readonly refreshUnclaimedTmuxSessions: ReturnType<typeof vi.fn>
    readonly listUnclaimedTmuxSessions: ReturnType<typeof vi.fn>
    readonly attachUnclaimedTmuxSession: ReturnType<typeof vi.fn>
    readonly killUnclaimedTmuxSession: ReturnType<typeof vi.fn>
}

function makeSession(overrides: Partial<UnclaimedTmuxSession> = {}): UnclaimedTmuxSession {
    return {
        sessionName: 'vt-1234567890-agent-a',
        terminalId: 'agent-a',
        hash: '1234567890',
        classification: 'this-project',
        attachable: true,
        createdAt: 1_779_365_910_000,
        panePid: 12345,
        agentName: 'Agent A',
        ...overrides,
    }
}

function installElectronApi(): MockMainApi {
    const main: MockMainApi = {
        refreshUnclaimedTmuxSessions: vi.fn().mockResolvedValue([]),
        listUnclaimedTmuxSessions: vi.fn().mockResolvedValue([]),
        attachUnclaimedTmuxSession: vi.fn().mockResolvedValue({success: true}),
        killUnclaimedTmuxSession: vi.fn().mockResolvedValue({success: true}),
    }
    Object.defineProperty(window, 'hostAPI', {
        configurable: true,
        value: {main},
    })
    return main
}

describe('UnclaimedTmuxStore', () => {
    let main: MockMainApi

    beforeEach(() => {
        main = installElectronApi()
        clearUnclaimedTmuxSessions()
    })

    afterEach(() => {
        stopUnclaimedTmuxPolling()
        clearUnclaimedTmuxSessions()
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('syncs pushed sessions and notifies subscribers', () => {
        const session: UnclaimedTmuxSession = makeSession()
        let observed: readonly UnclaimedTmuxSession[] = []

        const unsubscribe = subscribeToUnclaimedTmuxChanges((sessions) => {
            observed = sessions
        })

        syncUnclaimedTmuxFromMain([session])

        expect(getUnclaimedTmuxSessions()).toEqual([session])
        expect(observed).toEqual([session])

        unsubscribe()
    })

    it('refreshes through the main refresh API and updates local state', async () => {
        const session: UnclaimedTmuxSession = makeSession()
        main.refreshUnclaimedTmuxSessions.mockResolvedValue([session])

        await refreshUnclaimedTmuxSessions()

        expect(main.refreshUnclaimedTmuxSessions).toHaveBeenCalledTimes(1)
        expect(main.listUnclaimedTmuxSessions).not.toHaveBeenCalled()
        expect(getUnclaimedTmuxSessions()).toEqual([session])
    })

    it('falls back to the list API when refresh is unavailable', async () => {
        const session: UnclaimedTmuxSession = makeSession()
        Object.defineProperty(window, 'hostAPI', {
            configurable: true,
            value: {
                main: {
                    ...main,
                    refreshUnclaimedTmuxSessions: undefined,
                    listUnclaimedTmuxSessions: vi.fn().mockResolvedValue([session]),
                },
            },
        })

        await refreshUnclaimedTmuxSessions()

        expect(getUnclaimedTmuxSessions()).toEqual([session])
    })

    it('optimistically removes attached sessions', async () => {
        const first: UnclaimedTmuxSession = makeSession()
        const second: UnclaimedTmuxSession = makeSession({
            sessionName: 'vt-1234567890-agent-b',
            terminalId: 'agent-b',
            agentName: 'Agent B',
        })
        syncUnclaimedTmuxFromMain([first, second])
        main.refreshUnclaimedTmuxSessions.mockResolvedValue([second])

        const result = await attachUnclaimedTmuxSession(first.sessionName)

        expect(result.success).toBe(true)
        expect(main.attachUnclaimedTmuxSession).toHaveBeenCalledWith(first.sessionName)
        expect(getUnclaimedTmuxSessions()).toEqual([second])
    })

    it('optimistically removes killed sessions', async () => {
        const session: UnclaimedTmuxSession = makeSession()
        syncUnclaimedTmuxFromMain([session])

        const result = await killUnclaimedTmuxSession(session.sessionName)

        expect(result.success).toBe(true)
        expect(main.killUnclaimedTmuxSession).toHaveBeenCalledWith(session.sessionName)
        expect(getUnclaimedTmuxSessions()).toEqual([])
    })

    it('refreshes once when lifecycle starts and does not allocate renderer polling', () => {
        vi.useFakeTimers()

        startUnclaimedTmuxPolling()
        expect(main.refreshUnclaimedTmuxSessions).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(10_000)
        expect(main.refreshUnclaimedTmuxSessions).toHaveBeenCalledTimes(1)

        stopUnclaimedTmuxPolling()
        vi.advanceTimersByTime(10_000)
        expect(main.refreshUnclaimedTmuxSessions).toHaveBeenCalledTimes(1)
    })
})
