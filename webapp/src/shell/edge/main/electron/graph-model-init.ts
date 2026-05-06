/**
 * Initialize @vt/graph-model with Electron-specific config and callbacks.
 *
 * Call ONCE at startup, before any graph-model function is invoked.
 * Bridges graph-model's DI callbacks to Electron APIs (dialog, IPC, uiAPI).
 */

import { app, dialog } from 'electron'
import * as O from 'fp-ts/lib/Option.js'
import { initGraphModel, type GraphModelCallbacks } from '@vt/graph-model'
import type { GraphDelta } from '@vt/graph-model/pure/graph'
import { configureRootIO } from '@vt/graph-state'
import { loadGraphFromDisk } from '@vt/graph-db-server/graph/loadGraphFromDisk'
import { getDirectoryTree } from '@/shell/edge/main/graph/watch_folder/folderScanning'
import { getWritePath } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { loadSettings } from '@vt/graph-db-server/settings/settings_IO'
import { getMainWindow } from '@/shell/edge/main/state/app-electron-state'
import { uiAPI } from '@/shell/edge/main/ui-api-proxy'
import { refreshAllInjectBadges } from '@/shell/edge/main/terminals/inject-badge-refresh'
import { dispatchOnNewNodeHooks } from '@/shell/edge/main/hooks/onNewNodeHook'
import { getTerminalRecords, resetAuditRetryCount, type TerminalRecord } from '@/shell/edge/main/terminals/terminal-registry'
import { registerAgentNodes } from '@/shell/edge/main/mcp-server/agentNodeIndex'
import { tellSTTServerToLoadDirectory } from '@/shell/edge/main/backend-api'
import { enableMcpJsonIntegration } from '@/shell/edge/main/mcp-server/mcp-client-config'
import { ensureProjectDotVoicetree } from '@/shell/edge/main/electron/tools-setup'
import { getOnboardingDirectory } from '@/shell/edge/main/electron/onboarding-setup'
import { ensureDaemonClientForVault } from '@/shell/edge/main/electron/graph-daemon'
import { isDaemonSSEActive } from '@/shell/edge/main/electron/daemon-sse-subscription'

const GRAPH_MODEL_DAEMON_TIMEOUT_MS: number = 15_000

export function initializeGraphModel(): void {
    configureRootIO({
        getDirectoryTree,
        loadGraphFromDisk,
    })

    const callbacks: GraphModelCallbacks = {
        // Core graph broadcasting
        onGraphDelta(delta: GraphDelta): void {
            if (isDaemonSSEActive()) return
            const mainWindow: Electron.BrowserWindow | null = getMainWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('graph:stateChanged', delta)
            }
        },
        onFloatingEditorUpdate(delta: GraphDelta): void {
            uiAPI.updateFloatingEditorsFromExternal(delta)
        },
        onGraphCleared(): void {
            const mainWindow: Electron.BrowserWindow | null = getMainWindow()
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
            const mainWindow: Electron.BrowserWindow | null = getMainWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('watching-started', info)
            }
        },
        onFolderCleared(): void {
            const mainWindow: Electron.BrowserWindow | null = getMainWindow()
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('folder:cleared')
            }
        },

        // Dialogs
        async openFolderDialog(): Promise<string | undefined> {
            const mainWindow: Electron.BrowserWindow | null = getMainWindow()
            if (!mainWindow) return undefined
            const result: Electron.OpenDialogReturnValue = await dialog.showOpenDialog(mainWindow, {
                properties: ['openDirectory']
            })
            return result.canceled ? undefined : result.filePaths[0]
        },
        async showInfoDialog(title: string, message: string): Promise<void> {
            const mainWindow: Electron.BrowserWindow | null = getMainWindow()
            if (!mainWindow) return
            await dialog.showMessageBox(mainWindow, { type: 'info', title, message })
        },

        // UI state syncing
        fitViewport(): void {
            uiAPI.fitViewport()
        },
        syncVaultState(state): void {
            uiAPI.syncVaultState({
                readPaths: [...state.vaultPaths],
                writePath: state.writePath,
                starredFolders: [...state.starredFolders],
            })
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
        onFSNodeWithAgentName(agentName: string, nodeId: string, title: string): void {
            const record: TerminalRecord | undefined = getTerminalRecords().find(
                (r: TerminalRecord) => r.terminalData.agentName === agentName
            )
            if (!record) return
            registerAgentNodes(record.terminalId, [{ nodeId, title }])
            resetAuditRetryCount(record.terminalId)
        },
        refreshBadge(): void {
            refreshAllInjectBadges()
        },

        // Backend notification
        notifyWriteDirectory(dirPath: string): void {
            void tellSTTServerToLoadDirectory(dirPath)
        },
        async semanticSearch(query: string, topK: number): Promise<readonly string[]> {
            const writePath: O.Option<string> = await getWritePath()
            if (O.isNone(writePath)) {
                return []
            }

            try {
                const { search }: typeof import('@vt/graph-model') = await import('@vt/graph-model')
                const hits: readonly { nodePath: string }[] = await search(writePath.value, query, topK)
                return hits.map((hit: { nodePath: string }) => hit.nodePath)
            } catch {
                return []
            }
        },
        async getWritePath(): Promise<string | null> {
            const writePath: O.Option<string> = await getWritePath()
            return O.isSome(writePath) ? writePath.value : null
        },

        // App-specific setup
        enableMcpIntegration(): Promise<void> {
            return enableMcpJsonIntegration()
        },
        ensureProjectSetup(projectPath: string): Promise<void> {
            return ensureProjectDotVoicetree(projectPath)
        },
        ensureDaemonForVault(vaultPath: string): Promise<void> {
            return ensureDaemonClientForVault(vaultPath, {
                timeoutMs: GRAPH_MODEL_DAEMON_TIMEOUT_MS,
            }).then(() => undefined)
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
