import {app, BrowserWindow, dialog} from 'electron'
import type {TerminalRecord} from '@/shell/edge/main/agent/terminals/terminalRuntimeSurface'
import {
    buildQuitTmuxSessionPromptModel,
    cleanupPolicyForQuitTmuxDecision,
    getActiveTmuxSessionSummaries,
    type QuitTmuxCleanupPolicy,
    type QuitTmuxSessionPromptModel,
    type QuitTmuxSessionSummary,
} from './quit-tmux-session-prompt'

type StoppableHandle = {
    stop(): Promise<void>
}

type TerminalManagerForQuit = {
    cleanup(policy: QuitTmuxCleanupPolicy): void
    cleanupAndWait(policy: QuitTmuxCleanupPolicy): Promise<void>
}

export type QuitLifecycleDeps = {
    readonly cleanupOrphanedContextNodes: () => Promise<unknown>
    readonly clearMcpHandle: () => void
    readonly disableMcpJsonIntegration: () => Promise<unknown>
    readonly getMcpHandle: () => StoppableHandle | null
    readonly getTerminalRecords: () => readonly TerminalRecord[]
    readonly setIsQuitting: (value: boolean) => void
    readonly stopNotificationScheduler: () => void
    readonly stopRecoverySessionPolling: () => void
    readonly stopTextToTreeServer: () => void
    readonly stopTrackpadMonitoring: () => void
    readonly stopUnclaimedTmuxSessionPolling: () => void
    readonly terminalManager: TerminalManagerForQuit
    readonly unregisterInstance: () => void
}

type QuitLifecycleState = {
    quitCleanupCompleted: boolean
    quitPromptInProgress: boolean
}

function stopMcpServerForQuit(deps: QuitLifecycleDeps): Promise<void> | void {
    const handle: StoppableHandle | null = deps.getMcpHandle()
    if (!handle) return
    deps.clearMcpHandle()
    return handle.stop().catch((err: unknown) => {
        console.warn('[App] Failed to stop MCP server:', err)
    })
}

function runNonTerminalQuitCleanup(deps: QuitLifecycleDeps): void {
    deps.stopUnclaimedTmuxSessionPolling()
    deps.stopRecoverySessionPolling()
    void deps.cleanupOrphanedContextNodes().catch((error: unknown) => {
        console.warn('[App] Failed to clean up orphaned context nodes before quit:', error)
    })
    void deps.disableMcpJsonIntegration().catch((error: unknown) => {
        console.warn('[App] Failed to disable .mcp.json integration before quit:', error)
    })
    // OTLP receiver lifecycle is owned by `http-server-binding.unbindHttpDaemon()`;
    // it's torn down with the daemon when the vault unbinds at quit.
    deps.stopNotificationScheduler()
    deps.stopTrackpadMonitoring()
}

function runBeforeQuitCleanup(deps: QuitLifecycleDeps, policy: QuitTmuxCleanupPolicy): void {
    deps.unregisterInstance()
    deps.stopTextToTreeServer()
    void stopMcpServerForQuit(deps)
    deps.terminalManager.cleanup(policy)
    runNonTerminalQuitCleanup(deps)
}

async function runBeforeQuitCleanupAndWait(deps: QuitLifecycleDeps, policy: QuitTmuxCleanupPolicy): Promise<void> {
    deps.unregisterInstance()
    deps.stopTextToTreeServer()
    await stopMcpServerForQuit(deps)
    await deps.terminalManager.cleanupAndWait(policy)
    runNonTerminalQuitCleanup(deps)
}

function getQuitDialogParentWindow(): BrowserWindow | undefined {
    const focusedWindow: BrowserWindow | null = BrowserWindow.getFocusedWindow()
    if (focusedWindow && !focusedWindow.isDestroyed()) return focusedWindow
    return BrowserWindow.getAllWindows().find((window: BrowserWindow): boolean => !window.isDestroyed())
}

async function promptForTmuxQuitPolicy(
    activeSessions: readonly QuitTmuxSessionSummary[],
): Promise<QuitTmuxCleanupPolicy | null> {
    const model: QuitTmuxSessionPromptModel = buildQuitTmuxSessionPromptModel(activeSessions)
    const options = {
        type: model.type,
        title: model.title,
        message: model.message,
        detail: model.detail,
        buttons: [...model.buttons],
        defaultId: model.defaultId,
        cancelId: model.cancelId,
        noLink: model.noLink,
    }
    const parentWindow: BrowserWindow | undefined = getQuitDialogParentWindow()
    const result: Electron.MessageBoxReturnValue = parentWindow
        ? await dialog.showMessageBox(parentWindow, options)
        : await dialog.showMessageBox(options)
    return cleanupPolicyForQuitTmuxDecision(model.choices[result.response] ?? 'cancel')
}

function handleBeforeQuit(deps: QuitLifecycleDeps, state: QuitLifecycleState, event: Electron.Event): void {
    if (state.quitCleanupCompleted) {
        deps.setIsQuitting(true)
        return
    }

    const activeSessions: readonly QuitTmuxSessionSummary[] = getActiveTmuxSessionSummaries(deps.getTerminalRecords())
    if (activeSessions.length === 0) {
        deps.setIsQuitting(true)
        runBeforeQuitCleanup(deps, {tmuxSessions: 'preserve'})
        return
    }

    event.preventDefault()
    if (state.quitPromptInProgress) return

    state.quitPromptInProgress = true
    deps.setIsQuitting(true)
    void (async (): Promise<void> => {
        const policy: QuitTmuxCleanupPolicy | null = await promptForTmuxQuitPolicy(activeSessions)
        if (!policy) {
            state.quitPromptInProgress = false
            deps.setIsQuitting(false)
            return
        }

        try {
            await runBeforeQuitCleanupAndWait(deps, policy)
        } finally {
            state.quitCleanupCompleted = true
            state.quitPromptInProgress = false
            app.quit()
        }
    })()
}

function handleWindowAllClosed(deps: QuitLifecycleDeps): void {
    if (process.platform === 'darwin') {
        deps.terminalManager.cleanup({tmuxSessions: 'preserve'})
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
