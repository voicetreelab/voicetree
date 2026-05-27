/**
 * Initialize @vt/graph-model with Electron-specific config and callbacks.
 *
 * Call ONCE at startup, before any graph-model function is invoked.
 * Bridges graph-model's DI callbacks to Electron APIs (dialog, IPC, uiAPI).
 */

import { dialog } from 'electron'
import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'
import { initGraphModel, type GraphModelCallbacks } from '@vt/graph-model'
import type { Graph, GraphDelta } from '@vt/graph-model/graph'
import { configureRootIO } from '@vt/graph-state'
import { dispatchOnNewNodeHooks } from '@vt/vt-daemon-client'
import { getDirectoryTree } from '@/shell/edge/main/graph/watch_folder/folderScanning'
import { getWriteFolder, openVault } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { loadSettings } from '@vt/app-config/settings'
import { getAppSupportPath } from '@/shell/edge/main/runtime/state/app-electron-state'
import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'
import { uiAPI } from '@/shell/edge/main/runtime/ui-api-proxy'
import { refreshAllInjectBadges } from '@/shell/edge/main/agent/terminals/inject-badge-refresh'
import { stripStaleVoicetreeMcpEntries } from '@/shell/edge/main/runtime/electron/startup/vault-bootstrap/mcp-client-config'
import { writeVaultAgentDiscoveryFile } from '@/shell/edge/main/runtime/electron/startup/vault-bootstrap/vaultAgentDiscoveryFile'
import { tellSTTServerToLoadDirectory } from '@/shell/edge/main/runtime/backend-api'
import { ensureProjectDotVoicetree } from '@/shell/edge/main/runtime/electron/startup/tools-setup'
import { getBuildConfig } from '@/shell/edge/main/runtime/electron/app/build-config'
import { getOnboardingDirectory } from '@/shell/edge/main/runtime/electron/startup/onboarding-setup'
import { getActiveDaemonClient } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'
import { getVtDaemonClient } from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import { getNormalizedDaemonGraph } from '@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-normalization'

async function loadGraphThroughDaemon(_vaultPaths: readonly string[]): Promise<E.Either<unknown, Graph>> {
    // Post BF-345: there is no vaultless daemon fallback. Callers that need a
    // graph must open a vault first; until then this hook returns Left so
    // graph-state surfaces a clean "no vault" error instead of implicitly
    // spawning a daemon (the cause of the May 22 vaultless fork storm).
    const activeClient = getActiveDaemonClient()
    return activeClient
        ? E.right(await getNormalizedDaemonGraph(activeClient))
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
                writeFolder: state.writeFolder,
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
        onNewNodeHook(_nodeId: string, graphData: GraphDelta): void {
            void loadSettings(getAppSupportPath()).then(async settings => {
                const hookPath: string | undefined = settings.hooks?.onNewNode
                if (hookPath && !hookPath.startsWith('#')) {
                    await dispatchOnNewNodeHooks(getVtDaemonClient(), { delta: graphData, hookCommand: hookPath })
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
        async semanticSearch(query: string, topK: number): Promise<readonly string[]> {
            const writeFolder: O.Option<string> = await getWriteFolder()
            if (O.isNone(writeFolder)) {
                return []
            }

            try {
                const { search }: typeof import('@vt/graph-model') = await import('@vt/graph-model')
                const hits: readonly { nodePath: string }[] = await search(writeFolder.value, query, topK)
                return hits.map((hit: { nodePath: string }) => hit.nodePath)
            } catch {
                return []
            }
        },
        async getWriteFolder(): Promise<string | null> {
            const writeFolder: O.Option<string> = await getWriteFolder()
            return O.isSome(writeFolder) ? writeFolder.value : null
        },

        // App-specific setup
        stripStaleMcpEntries(vaultDir: string): Promise<void> {
            return stripStaleVoicetreeMcpEntries(vaultDir)
        },
        writeVaultAgentDiscoveryFile(vaultDir: string): Promise<void> {
            return writeVaultAgentDiscoveryFile(vaultDir, getBuildConfig().cliManualPath)
        },
        ensureProjectSetup(projectPath: string): Promise<void> {
            return ensureProjectDotVoicetree(projectPath)
        },
        ensureDaemonForVault(projectRoot: string): Promise<void> {
            return openVault(projectRoot).then(() => undefined)
        },
        getOnboardingDirectory(): string {
            return getOnboardingDirectory()
        },
    }

    initGraphModel(callbacks)
}
