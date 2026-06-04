// Push the daemon's current project + folder-tree state to the Electron
// renderer over IPC. This is the one place that fans the per-project sidebar
// projection out to the four `uiAPI.sync*` channels the renderer's stores
// consume. The folder-tree payload itself is built by VTD (the Main→VTD
// convergence) so Electron Main and browser mode share one server-side
// implementation.

import type { Graph } from '@vt/graph-model'
import { tracing } from '@vt/observability'
import type { GraphDbClient, ProjectState } from '@vt/graph-db-client'
import type { GraphGetFolderTreeSync } from '@vt/vt-daemon-protocol'

import { uiAPI } from '@/shell/edge/main/runtime/ui-api-proxy'
import { getMainWindow } from '@/shell/edge/main/runtime/state/app-electron-state'
import { getFolderTreeSync } from '@/shell/edge/main/graph/watch_folder/folderQueries'

export function graphNodeCount(graph: Graph): number {
  return Object.keys(graph.nodes).length
}

function recordCount(value: Record<string, unknown>): number {
  return Object.keys(value).length
}

/**
 * Build the folder-tree sidebar payload (via VTD) and push project paths, the
 * root tree, and the starred/external trees to the renderer. A destroyed/absent
 * main window short-circuits to a no-op. `nextGraph` is carried only for the
 * span's node-count attribute — the payload is sourced from VTD, which reads the
 * same vt-graphd this process syncs from.
 */
export async function syncRendererFromDaemon(
  client: GraphDbClient,
  nextGraph: Graph,
  projectState: ProjectState,
): Promise<void> {
  await tracing.span('electron.renderer.sync-from-daemon', async (span) => {
    span.setAttribute('daemon.base_url', client.baseUrl)
    span.setAttribute('graph.node.count', graphNodeCount(nextGraph))
    span.setAttribute('project.read_path.count', projectState.readPaths.length)
    span.setAttribute('project.write_folder', projectState.writeFolderPath)

    const mainWindow: Electron.BrowserWindow | null = getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      span.addEvent('electron.renderer.sync.skipped', {
        reason: 'main-window-unavailable',
      })
      return
    }

    span.addEvent('electron.renderer.folder-tree-build.start')
    // VTD builds the payload from the SAME vt-graphd + settings + FS this process
    // reads, so the sidebar projection has one server-side implementation behind
    // both Electron Main and browser mode (the Main→VTD convergence).
    const treePayload: GraphGetFolderTreeSync.Response = await getFolderTreeSync()
    span.setAttribute('folder_tree.has_root', treePayload.rootTree !== null)
    span.setAttribute('folder_tree.starred.count', treePayload.starredFolders.length)
    span.setAttribute('folder_tree.starred_tree.count', recordCount(treePayload.starredTrees))
    span.setAttribute('folder_tree.external_tree.count', recordCount(treePayload.externalTrees))
    span.addEvent('electron.renderer.folder-tree-build.complete')

    uiAPI.syncProjectState({
      readPaths: projectState.readPaths,
      starredFolders: treePayload.starredFolders,
      writeFolderPath: projectState.writeFolderPath,
    })

    if (treePayload.rootTree) {
      uiAPI.syncFolderTree(treePayload.rootTree)
    }

    uiAPI.syncStarredFolderTrees(treePayload.starredTrees)
    uiAPI.syncExternalFolderTrees(treePayload.externalTrees)
    span.addEvent('electron.renderer.sync.sent')
  })
}
