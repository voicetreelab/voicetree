import {beforeEach, describe, expect, it, vi} from 'vitest'
import {installQuitLifecycleHandlers, type QuitLifecycleDeps} from './quit-lifecycle'

const {
    appQuitCount,
    cachedTerminalRecords,
    dialogOptions,
    dialogResponse,
    registeredAppHandlers,
} = vi.hoisted(() => ({
    appQuitCount: {value: 0},
    cachedTerminalRecords: {value: [] as readonly unknown[]},
    dialogOptions: [] as unknown[],
    dialogResponse: {value: 0},
    registeredAppHandlers: new Map<string, (...args: readonly unknown[]) => void>(),
}))

vi.mock('electron', () => ({
    app: {
        on: (eventName: string, handler: (...args: readonly unknown[]) => void): void => {
            registeredAppHandlers.set(eventName, handler)
        },
        quit: (): void => {
            appQuitCount.value += 1
        },
    },
    BrowserWindow: {
        getAllWindows: (): readonly unknown[] => [],
        getFocusedWindow: (): null => null,
    },
    dialog: {
        showMessageBox: async (...args: readonly unknown[]): Promise<{response: number}> => {
            dialogOptions.push(args[args.length - 1])
            return {response: dialogResponse.value}
        },
    },
}))

vi.mock('@/shell/edge/main/agent/terminals/terminal-registry-bridge', () => ({
    getCachedTerminalRecords: (): readonly unknown[] => cachedTerminalRecords.value,
}))

type Counter = {
    readonly get: () => number
    readonly increment: () => void
}

function createCounter(): Counter {
    let count = 0
    return {
        get: (): number => count,
        increment: (): void => {
            count += 1
        },
    }
}

function createBeforeQuitEvent(): {readonly prevented: () => boolean; readonly event: {preventDefault: () => void}} {
    let wasPrevented = false
    return {
        prevented: (): boolean => wasPrevented,
        event: {
            preventDefault: (): void => {
                wasPrevented = true
            },
        },
    }
}

function createLifecycleDeps(cleanupCount: Counter, quittingValues: boolean[]): QuitLifecycleDeps {
    return {
        cleanupOrphanedContextNodes: async (): Promise<void> => {
            cleanupCount.increment()
        },
        setIsQuitting: (value: boolean): void => {
            quittingValues.push(value)
        },
        stopNotificationScheduler: cleanupCount.increment,
        stopRecoverySessionPolling: cleanupCount.increment,
        stopTextToTreeServer: cleanupCount.increment,
        stopTrackpadMonitoring: cleanupCount.increment,
        stopUnclaimedTmuxSessionPolling: cleanupCount.increment,
        unregisterInstance: cleanupCount.increment,
    }
}

async function flushQuitPrompt(): Promise<void> {
    await Promise.resolve()
    await Promise.resolve()
}

describe('quit lifecycle', () => {
    beforeEach(() => {
        appQuitCount.value = 0
        cachedTerminalRecords.value = []
        dialogOptions.length = 0
        dialogResponse.value = 0
        registeredAppHandlers.clear()
    })

    it('allows cancelling an accidental quit when active tmux sessions exist', async () => {
        cachedTerminalRecords.value = [
            {
                terminalId: 'Ben',
                status: 'running',
                terminalData: {
                    agentName: 'Codex',
                    isHeadless: false,
                    title: 'Layout fix',
                },
            },
        ]
        dialogResponse.value = 1
        const cleanupCount = createCounter()
        const quittingValues: boolean[] = []
        installQuitLifecycleHandlers(createLifecycleDeps(cleanupCount, quittingValues))

        const {event, prevented} = createBeforeQuitEvent()
        registeredAppHandlers.get('before-quit')?.(event)
        await flushQuitPrompt()

        expect(prevented()).toBe(true)
        expect(dialogOptions).toEqual([
            expect.objectContaining({
                buttons: ['Quit', 'Cancel Quit'],
                cancelId: 1,
                defaultId: 0,
                message: 'Quit Voicetree?',
            }),
        ])
        expect(cleanupCount.get()).toBe(0)
        expect(appQuitCount.value).toBe(0)
        expect(quittingValues).toEqual([false])
    })

    it('continues cleanup and quits when the active-session prompt is accepted', async () => {
        cachedTerminalRecords.value = [
            {
                terminalId: 'Ben',
                status: 'running',
                terminalData: {
                    agentName: 'Codex',
                    isHeadless: false,
                    title: 'Layout fix',
                },
            },
        ]
        dialogResponse.value = 0
        const cleanupCount = createCounter()
        const quittingValues: boolean[] = []
        installQuitLifecycleHandlers(createLifecycleDeps(cleanupCount, quittingValues))

        const {event, prevented} = createBeforeQuitEvent()
        registeredAppHandlers.get('before-quit')?.(event)
        await flushQuitPrompt()

        expect(prevented()).toBe(true)
        expect(dialogOptions).toEqual([
            expect.objectContaining({
                buttons: ['Quit', 'Cancel Quit'],
                cancelId: 1,
            }),
        ])
        expect(cleanupCount.get()).toBe(7)
        expect(appQuitCount.value).toBe(1)
        expect(quittingValues).toEqual([true])
    })
})
