/**
 * Initialize @vt/graph-model with Electron-specific config and callbacks.
 *
 * Call ONCE at startup, before any graph-model function is invoked.
 * Bridges graph-model's DI callbacks to Electron APIs (dialog, IPC, uiAPI).
 */

import { app, dialog } from 'electron'
import { initGraphModel, type GraphModelCallbacks } from '@vt/graph-model'
import { getMainWindow } from '@/shell/edge/main/state/app-electron-state'
import { uiAPI } from '@/shell/edge/main/ui-api-proxy'
import { refreshAllInjectBadges } from '@/shell/edge/main/terminals/inject-badge-refresh'
import { dispatchOnNewNodeHooks } from '@/shell/edge/main/hooks/onNewNodeHook'
import { tellSTTServerToLoadDirectory } from '@/shell/edge/main/backend-api'
import { enableMcpJsonIntegration } from '@/shell/edge/main/mcp-server/mcp-client-config'
import { ensureProjectDotVoicetree } from '@/shell/edge/main/electron/tools-setup'
import { getOnboardingDirectory } from '@/shell/edge/main/electron/onboarding-setup'
import { loadSettings } from '@vt/graph-model'
import type { GraphDelta } from '@/pure/graph'

export function initializeGraphModel(): void {
    const callbacks: GraphModelCallbacks = {
        // Core graph broadcasting
        onGraphDelta(delta: GraphDelta): void {
            const mainWindow = getMainWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('graph:stateChanged', delta)
            }
        },
        onFloatingEditorUpdate(delta: GraphDelta): void {
            uiAPI.updateFloatingEditorsFromExternal(delta)
        },
        onGraphCleared(): void {
            const mainWindow = getMainWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('graph:clear')
            }
        },

        // Settings
        onSettingsChanged(): void {
            uiAPI.onSettingsChanged()
        },

        // Watch folder events
        onWatchingStarted(info): void {
            const mainWindow = getMainWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('watching:started', info)
            }
        },
        onFolderCleared(): void {
            const mainWindow = getMainWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('folder:cleared')
            }
        },

        // Dialogs
        async openFolderDialog(): Promise<string | undefined> {
            const mainWindow = getMainWindow()
            if (!mainWindow) return undefined
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory']
            })
            return result.canceled ? undefined : result.filePaths[0]
        },
        async showInfoDialog(title: string, message: string): Promise<void> {
            const mainWindow = getMainWindow()
            if (!mainWindow) return
            await dialog.showMessageBox(mainWindow, { type: 'info', title, message })
        },

        // UI state syncing
        fitViewport(): void {
            uiAPI.fitViewport()
        },
        syncVaultState(state): void {
            uiAPI.syncVaultState(state)
        },
        syncFolderTree(tree): void {
            uiAPI.syncFolderTree(tree)
        },
        syncStarredFolderTrees(trees): void {
            uiAPI.syncStarredFolderTrees(trees)
        },
        syncExternalFolderTrees(trees): void {
            uiAPI.syncExternalFolderTrees(trees)
        },

        // Hooks
        onNewNodeHook(nodeId: string, graphData: GraphDelta): void {
            void loadSettings().then(settings => {
                const hookPath: string | undefined = settings.hooks?.onNewNode
                if (hookPath && !hookPath.startsWith('#')) {
                    // Create a single-node delta for dispatch
                    dispatchOnNewNodeHooks(graphData, hookPath)
                }
            })
        },
        refreshBadge(): void {
            refreshAllInjectBadges()
        },

        // Backend notification
        notifyWriteDirectory(dirPath: string): void {
            void tellSTTServerToLoadDirectory(dirPath)
        },

        // App-specific setup
        enableMcpIntegration(): Promise<void> {
            return enableMcpJsonIntegration()
        },
        ensureProjectSetup(projectPath: string): Promise<void> {
            return ensureProjectDotVoicetree(projectPath)
        },
        getOnboardingDirectory(): string {
            return getOnboardingDirectory()
        },
    }

    initGraphModel(
        { appSupportPath: app.getPath('userData') },
        callbacks
    )
}
