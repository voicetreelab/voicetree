/**
 * Initialize @vt/graph-model with Electron-specific config and callbacks.
 *
 * Call ONCE at startup, before any graph-model function is invoked.
 * Bridges graph-model's DI callbacks to Electron APIs (dialog, IPC, uiAPI).
 */

import { app, dialog } from 'electron'
import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import { initGraphModel, type GraphModelCallbacks } from '@vt/graph-model'
import type { Graph, GraphDelta } from '@vt/graph-model/graph'
import { configureRootIO } from '@vt/graph-state'
import { getDirectoryTree } from '@/shell/edge/main/graph/watch_folder/folderScanning'
import { getWritePath, openVault } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { loadSettings } from '@vt/app-config/settings'
import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'
import { uiAPI } from '@/shell/edge/main/runtime/ui-api-proxy'
import { refreshAllInjectBadges } from '@/shell/edge/main/agent/terminals/inject-badge-refresh'
import { terminalRuntimeSurface, type TerminalRecord } from '@/shell/edge/main/agent/terminals/terminalRuntimeSurface'
import { registerAgentNodes } from '@vt/voicetree-mcp'
import { tellSTTServerToLoadDirectory } from '@/shell/edge/main/runtime/backend-api'
import { enableMcpClientIntegrations } from '@vt/voicetree-mcp'
import { ensureProjectDotVoicetree } from '@/shell/edge/main/runtime/electron/startup/tools-setup'
import { getOnboardingDirectory } from '@/shell/edge/main/runtime/electron/startup/onboarding-setup'
import { ensureDaemonProcess, getActiveDaemonClient } from '@/shell/edge/main/runtime/electron/daemon/graph-daemon'
import { getNormalizedDaemonGraph } from '@/shell/edge/main/runtime/electron/daemon/daemon-graph-normalization'

async function loadGraphThroughDaemon(vaultPaths: readonly string[]): Promise<E.Either<unknown, Graph>> {
    const activeClient = getActiveDaemonClient()
    const client = activeClient ?? (vaultPaths[0] ? (await ensureDaemonProcess()).client : null)

    return client
        ? E.right(await getNormalizedDaemonGraph(client))
        : E.left(new Error('No daemon client available for graph load'))
}

export function initializeGraphModel(): void {
    configureRootIO({
        getDirectoryTree,
        loadGraphFromDisk: loadGraphThroughDaemon,
    })

    const callbacks: GraphModelCallbacks = {
        onFloatingEditorUpdate(delta: GraphDelta, suppressForSubscribers?: readonly string[]): void {
            uiAPI.updateFloatingEditorsFromExternal(delta, suppressForSubscribers ?? [])
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
                    terminalRuntimeSurface.dispatchOnNewNodeHooks(graphData, hookPath, uiAPI.logHookResult)
                }
            })
        },
        onFSNodeWithAgentName(agentName: string, nodeId: string, title: string): void {
            const record: TerminalRecord | undefined = terminalRuntimeSurface.getTerminalRecords().find(
                (r: TerminalRecord) => r.terminalData.agentName === agentName
            )
            if (!record) return
            registerAgentNodes(record.terminalId, [{ nodeId, title }])
            terminalRuntimeSurface.resetAuditRetryCount(record.terminalId)
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
            return enableMcpClientIntegrations()
        },
        ensureProjectSetup(projectPath: string): Promise<void> {
            return ensureProjectDotVoicetree(projectPath)
        },
        ensureDaemonForVault(vaultPath: string): Promise<void> {
            return openVault(vaultPath).then(() => undefined)
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
