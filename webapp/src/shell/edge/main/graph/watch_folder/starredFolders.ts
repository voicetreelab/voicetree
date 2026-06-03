import { getNodeThroughDaemon } from '@/shell/edge/main/runtime/electron/daemon/queries/daemon-graph-queries'
import { loadSettings } from '@/shell/edge/main/settings/settings_IO'
import { getProjectPaths, getWriteFolderPath } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import { uiAPI } from '@/shell/edge/main/runtime/ui-api-proxy'
import {
    getStarredFolders,
    isStarred,
    addStarredFolder as addStarredFolderToSettings,
    removeStarredFolder as removeStarredFolderFromSettings,
    copyNodeToFolder as copyNodeToFolderShared,
    type CopyNodeResult,
} from '@vt/app-config/folders'
import type { GraphNode } from '@vt/graph-model/graph'
import type { VTSettings } from '@vt/graph-model/settings'
import * as O from 'fp-ts/lib/Option.js'

// Starred-folder data + copy live in @vt/app-config/folders (shared with VTD's
// browser-mode gateway). This Electron module wraps the mutations to also push
// the refreshed project state to the renderer over IPC, and resolves the node to
// copy through the daemon.
export { getStarredFolders, isStarred }

async function syncProjectStateToRenderer(): Promise<void> {
    const settings: VTSettings = await loadSettings()
    const writeFolderPathOption: O.Option<string> = await getWriteFolderPath()
    uiAPI.syncProjectState({
        readPaths: [...await getProjectPaths()],
        writeFolderPath: O.isSome(writeFolderPathOption) ? writeFolderPathOption.value : null,
        starredFolders: settings.starredFolders ?? [],
    })
}

export async function addStarredFolder(folderPath: string): Promise<void> {
    await addStarredFolderToSettings(folderPath)
    await syncProjectStateToRenderer()
}

export async function removeStarredFolder(folderPath: string): Promise<void> {
    await removeStarredFolderFromSettings(folderPath)
    await syncProjectStateToRenderer()
}

export async function copyNodeToFolder(
    nodeId: string,
    targetFolderPath: string,
): Promise<CopyNodeResult> {
    const node: GraphNode | undefined = await getNodeThroughDaemon(nodeId)
    return copyNodeToFolderShared(node, nodeId, targetFolderPath)
}
