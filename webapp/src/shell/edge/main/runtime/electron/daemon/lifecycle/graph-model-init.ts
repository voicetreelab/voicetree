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
import { getWriteFolderPath, openProject } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { loadSettings } from '@vt/app-config/settings'
import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'
import { uiAPI } from '@/shell/edge/main/runtime/ui-api-proxy'
import { refreshAllInjectBadges } from '@/shell/edge/main/agent/terminals/inject-badge-refresh'
import { stripStaleVoicetreeMcpEntries } from '@/shell/edge/main/runtime/electron/startup/project-bootstrap/mcp-client-config'
import { writeProjectAgentDiscoveryFile } from '@/shell/edge/main/runtime/electron/startup/project-bootstrap/projectAgentDiscoveryFile'
import { tellSTTServerToLoadDirectory } from '@/shell/edge/main/runtime/backend-api'
import { ensureProjectDotVoicetree } from '@/shell/edge/main/runtime/electron/startup/tools-setup'
import { getOnboardingDirectory } from '@/shell/edge/main/runtime/electron/startup/onboarding-setup'
import { getActiveDaemonClient } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'
import { getVtDaemonClient } from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import { getNormalizedDaemonGraph } from '@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-normalization'

async function loadGraphThroughDaemon(_projectPaths: readonly string[]): Promise<E.Either<unknown, Graph>> {
    // Post BF-345: there is no projectless daemon fallback. Callers that need a
    // graph must open a project first; until then this hook returns Left so
    // graph-state surfaces a clean "no project" error instead of implicitly
    // spawning a daemon (the cause of the May 22 projectless fork storm).
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
        syncProjectState(state): void {
            uiAPI.syncProjectState({
                readPaths: [...state.projectPaths],
                writeFolderPath: state.writeFolderPath,
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
            void loadSettings().then(async settings => {
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
            const writeFolderPath: O.Option<string> = await getWriteFolderPath()
            if (O.isNone(writeFolderPath)) {
                return []
            }

            try {
                const { search }: typeof import('@vt/graph-model') = await import('@vt/graph-model')
                const hits: readonly { nodePath: string }[] = await search(writeFolderPath.value, query, topK)
                return hits.map((hit: { nodePath: string }) => hit.nodePath)
            } catch {
                return []
            }
        },
        async getWriteFolderPath(): Promise<string | null> {
            const writeFolderPath: O.Option<string> = await getWriteFolderPath()
            return O.isSome(writeFolderPath) ? writeFolderPath.value : null
        },

        // App-specific setup
        stripStaleMcpEntries(projectDir: string): Promise<void> {
            return stripStaleVoicetreeMcpEntries(projectDir)
        },
        writeProjectAgentDiscoveryFile(projectDir: string): Promise<void> {
            return writeProjectAgentDiscoveryFile(projectDir)
        },
        ensureProjectSetup(projectPath: string): Promise<void> {
            return ensureProjectDotVoicetree(projectPath)
        },
        ensureDaemonForProject(projectRoot: string): Promise<void> {
            return openProject(projectRoot).then(() => undefined)
        },
        getOnboardingDirectory(): string {
            return getOnboardingDirectory()
        },
    }

    initGraphModel(callbacks)
}
