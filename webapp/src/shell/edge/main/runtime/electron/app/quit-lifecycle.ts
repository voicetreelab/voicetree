import {app, BrowserWindow, dialog} from 'electron'
import {getCachedTerminalRecords} from '@/shell/edge/main/agent/terminals/terminal-registry-bridge'
import {
    buildQuitTmuxSessionPromptModel,
    getActiveTmuxSessionSummaries,
    type QuitTmuxSessionPromptModel,
    type QuitTmuxSessionSummary,
} from './quit-tmux-session-prompt'

export type QuitLifecycleDeps = {
    readonly cleanupOrphanedContextNodes: () => Promise<unknown>
    readonly setIsQuitting: (value: boolean) => void
    readonly stopNotificationScheduler: () => void
    readonly stopOTLPReceiver: () => unknown
    readonly stopRecoverySessionPolling: () => void
    readonly stopTextToTreeServer: () => void
    readonly stopTrackpadMonitoring: () => void
    readonly stopUnclaimedTmuxSessionPolling: () => void
    readonly unregisterInstance: () => void
}

type QuitLifecycleState = {
    quitCleanupCompleted: boolean
    quitPromptInProgress: boolean
}

function runQuitCleanup(deps: QuitLifecycleDeps): void {
    deps.unregisterInstance()
    deps.stopTextToTreeServer()
    deps.stopUnclaimedTmuxSessionPolling()
    deps.stopRecoverySessionPolling()
    void deps.cleanupOrphanedContextNodes().catch((error: unknown) => {
        console.warn('[App] Failed to clean up orphaned context nodes before quit:', error)
    })
    void deps.stopOTLPReceiver()
    deps.stopNotificationScheduler()
    deps.stopTrackpadMonitoring()
}

function getQuitDialogParentWindow(): BrowserWindow | undefined {
    const focusedWindow: BrowserWindow | null = BrowserWindow.getFocusedWindow()
    if (focusedWindow && !focusedWindow.isDestroyed()) return focusedWindow
    return BrowserWindow.getAllWindows().find((window: BrowserWindow): boolean => !window.isDestroyed())
}

async function showActiveSessionsAcknowledgement(
    activeSessions: readonly QuitTmuxSessionSummary[],
): Promise<void> {
    // Post-BF-376: tmux sessions are daemon-owned and outlive a webapp quit
    // by design — the daemon's parent-pid watchdog plus the orphan reaper at
    // next startup are the bounded cleanup paths. We still surface the
    // "running agents" notice so the user knows their work persists, but no
    // policy is enforced from webapp anymore.
    const model: QuitTmuxSessionPromptModel = buildQuitTmuxSessionPromptModel(activeSessions)
    const options = {
        type: model.type,
        title: model.title,
        message: model.message,
        detail: model.detail,
        buttons: ['Quit'],
        defaultId: 0,
        cancelId: 0,
        noLink: model.noLink,
    }
    const parentWindow: BrowserWindow | undefined = getQuitDialogParentWindow()
    await (parentWindow
        ? dialog.showMessageBox(parentWindow, options)
        : dialog.showMessageBox(options))
}

function handleBeforeQuit(deps: QuitLifecycleDeps, state: QuitLifecycleState, event: Electron.Event): void {
    if (state.quitCleanupCompleted) {
        deps.setIsQuitting(true)
        return
    }

    const activeSessions: readonly QuitTmuxSessionSummary[] =
        getActiveTmuxSessionSummaries(getCachedTerminalRecords())
    if (activeSessions.length === 0) {
        deps.setIsQuitting(true)
        runQuitCleanup(deps)
        state.quitCleanupCompleted = true
        return
    }

    event.preventDefault()
    if (state.quitPromptInProgress) return

    state.quitPromptInProgress = true
    deps.setIsQuitting(true)
    void (async (): Promise<void> => {
        try {
            await showActiveSessionsAcknowledgement(activeSessions)
            runQuitCleanup(deps)
        } finally {
            state.quitCleanupCompleted = true
            state.quitPromptInProgress = false
            app.quit()
        }
    })()
}

function handleWindowAllClosed(deps: QuitLifecycleDeps): void {
    if (process.platform === 'darwin') {
        deps.stopUnclaimedTmuxSessionPolling()
        deps.stopRecoverySessionPolling()
        return
    }

    app.quit()
}

export function installQuitLifecycleHandlers(deps: QuitLifecycleDeps): void {
    const state: QuitLifecycleState = {
        quitCleanupCompleted: false,
        quitPromptInProgress: false,
    }
    app.on('before-quit', (event: Electron.Event): void => handleBeforeQuit(deps, state, event))
    app.on('window-all-closed', (): void => handleWindowAllClosed(deps))
}
