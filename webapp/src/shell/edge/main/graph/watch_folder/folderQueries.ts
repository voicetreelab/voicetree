// Electron-main folder-browser operations, served by VTD over JSON-RPC.
//
// VTD owns the project's filesystem (it runs on the project's machine and fronts
// vt-graphd); Electron Main is a CLIENT of it, exactly like the browser adapter.
// These wrappers post the `graph.*` folder gateway methods through the bound
// VtDaemonClient and project each response onto the bare value the mainAPI
// contract returns — the SAME wire contract the browser's vtd-clients use, so
// there is one server-side implementation (in `@vt/app-config/folders`, called
// only by VTD) behind both hosts. This is the Main→VTD convergence: Electron
// Main no longer imports the folder implementation in-process.
//
// Starred-folder MUTATIONS additionally push the refreshed project state to the
// renderer over IPC (the Electron-side side effect the browser does not need),
// mirroring the prior in-process behaviour.

import {
    GATEWAY_METHODS,
    type GraphGetStarredFolders,
    type GraphCopyNodeToFolder,
    type GraphGetDirectoryTree,
    type GraphGetAvailableFolders,
    type GraphCreateSubfolder,
    type GraphCreateDatedVoiceTreeFolder,
    type GraphGetFolderTreeSync,
} from '@vt/vt-daemon-protocol'
import type {AvailableFolderItem, DirectoryEntry} from '@vt/graph-model/folders'
import {getVtDaemonClient} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy'

function vtdRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return getVtDaemonClient().rpc<T>(method, params)
}

// ---------------------------------------------------------------------------
// Folder-tree sidebar payload (root + starred + external trees + paths)
// ---------------------------------------------------------------------------

/**
 * The full folder-tree sidebar payload for the open project, built by VTD from
 * the SAME vt-graphd + settings + filesystem Electron Main reads. Pulled by the
 * daemon→renderer sync pump after each graph/project change and pushed into the
 * renderer's ProjectPathStore + folder-tree stores over IPC.
 */
export function getFolderTreeSync(): Promise<GraphGetFolderTreeSync.Response> {
    return vtdRpc<GraphGetFolderTreeSync.Response>(GATEWAY_METHODS.graph.getFolderTreeSync, {})
}

// ---------------------------------------------------------------------------
// Directory listing + "add folder" selector
// ---------------------------------------------------------------------------

/**
 * Recursive directory listing under `rootPath`, scoped to the project allowlist.
 * VTD returns `null` when the path escapes the allowlist; Electron Main only
 * ever scans allowlisted roots, so we coerce that to an empty directory entry to
 * preserve the non-null `Promise<DirectoryEntry>` contract `configureRootIO` and
 * the FolderTreeSidebar depend on.
 */
export async function getDirectoryTree(rootPath: string, maxDepth?: number): Promise<DirectoryEntry> {
    const entry: GraphGetDirectoryTree.Response = await vtdRpc<GraphGetDirectoryTree.Response>(
        GATEWAY_METHODS.graph.getDirectoryTree,
        {rootPath, maxDepth},
    )
    return entry ?? {absolutePath: rootPath as DirectoryEntry['absolutePath'], name: rootPath, isDirectory: true, children: []}
}

/** "Add folder" selector results for a search query, scoped to the allowlist. */
export async function getAvailableFoldersForSelector(
    searchQuery: string,
): Promise<readonly AvailableFolderItem[]> {
    try {
        return await vtdRpc<GraphGetAvailableFolders.Response>(
            GATEWAY_METHODS.graph.getAvailableFolders,
            {searchQuery},
        )
    } catch {
        return []
    }
}

// ---------------------------------------------------------------------------
// Folder-creation mutations
// ---------------------------------------------------------------------------

/** Create `folderName` under `parentPath` (mkdir), scoped to the allowlist. */
export function createSubfolder(
    parentPath: string,
    folderName: string,
): Promise<GraphCreateSubfolder.Response> {
    return vtdRpc<GraphCreateSubfolder.Response>(
        GATEWAY_METHODS.graph.createSubfolder,
        {parentPath, folderName},
    )
}

/**
 * Create a fresh dated voicetree folder, make it the sole loaded folder, and
 * point new-node creation at it ("New voicetree" button). VTD performs the
 * mkdir + write-folder switch + read-path unload server-side and pushes the
 * updated projected graph to subscribers.
 */
export function createDatedVoiceTreeFolder(): Promise<GraphCreateDatedVoiceTreeFolder.Response> {
    return vtdRpc<GraphCreateDatedVoiceTreeFolder.Response>(
        GATEWAY_METHODS.graph.createDatedVoiceTreeFolder,
        {},
    )
}

// ---------------------------------------------------------------------------
// Starred folders. VTD owns the settings file; the mutations additionally push
// refreshed project state to the renderer over IPC (Electron-only side effect).
// ---------------------------------------------------------------------------

export function getStarredFolders(): Promise<GraphGetStarredFolders.Response> {
    return vtdRpc<GraphGetStarredFolders.Response>(GATEWAY_METHODS.graph.getStarredFolders, {})
}

export async function isStarred(folderPath: string): Promise<boolean> {
    const folders: readonly string[] = await getStarredFolders()
    return folders.includes(folderPath)
}

async function syncProjectStateToRenderer(): Promise<void> {
    const payload: GraphGetFolderTreeSync.Response = await getFolderTreeSync()
    uiAPI.syncProjectState({
        readPaths: [...payload.readPaths],
        writeFolderPath: payload.writeFolderPath === '' ? null : payload.writeFolderPath,
        starredFolders: [...payload.starredFolders],
    })
}

export async function addStarredFolder(folderPath: string): Promise<void> {
    await vtdRpc<void>(GATEWAY_METHODS.graph.addStarredFolder, {folderPath})
    await syncProjectStateToRenderer()
}

export async function removeStarredFolder(folderPath: string): Promise<void> {
    await vtdRpc<void>(GATEWAY_METHODS.graph.removeStarredFolder, {folderPath})
    await syncProjectStateToRenderer()
}

export function copyNodeToFolder(
    nodeId: string,
    targetFolderPath: string,
): Promise<GraphCopyNodeToFolder.Response> {
    return vtdRpc<GraphCopyNodeToFolder.Response>(
        GATEWAY_METHODS.graph.copyNodeToFolder,
        {nodeId, targetFolderPath},
    )
}
