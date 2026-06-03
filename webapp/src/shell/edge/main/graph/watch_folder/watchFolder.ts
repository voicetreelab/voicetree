import * as O from 'fp-ts/lib/Option.js'
import { getCallbacks } from '@vt/graph-model'
import type { AvailableFolderItem, FilePath } from '@vt/graph-model'
import { createDatedSubfolder } from '@vt/app-config/project'
import { selectAvailableFolders } from '@vt/app-config/folders'
import type { ProjectState } from '@vt/graph-db-client'
import { stopDaemonGraphSync } from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-watch-sync'
import { callDaemon } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'
import {
    setWriteFolderPathThroughDaemon,
    removeReadPathThroughDaemon,
    refreshMainGraphFromDaemon,
} from '@/shell/edge/main/runtime/electron/daemon/ipc/daemon-ipc-proxy'
import {
    getStartupProjectHint,
    openProject,
} from './openProject'

export { getStartupProjectHint, openProject }

async function getProjectState(): Promise<ProjectState> {
    return await callDaemon((client) => client.getProject())
}

export async function getAvailableFoldersForSelector(
    searchQuery: string,
): Promise<readonly AvailableFolderItem[]> {
    // Shared with VTD's browser-mode gateway: the selector projection lives in
    // @vt/app-config/folders, parameterised by the live project state.
    try {
        return await selectAvailableFolders(await getProjectState(), searchQuery)
    } catch {
        return []
    }
}

export async function stopFileWatching(): Promise<{ readonly success: boolean; readonly error?: string }> {
    try {
        await stopDaemonGraphSync()
        await callDaemon((client) => client.closeProject())
        getCallbacks().onFolderCleared?.()
        return { success: true }
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
    }
}

export async function getWatchStatus(): Promise<{ readonly isWatching: boolean; readonly directory: string | undefined }> {
    try {
        const projectState: ProjectState = await getProjectState()
        return {
            isWatching: true,
            directory: projectState.projectRoot,
        }
    } catch {
        return { isWatching: false, directory: undefined }
    }
}

export async function isWatching(): Promise<boolean> {
    return (await getWatchStatus()).isWatching
}

export async function getProjectPaths(): Promise<readonly FilePath[]> {
    const daemonProjectState: ProjectState = await getProjectState()
    return [
        daemonProjectState.writeFolderPath,
        ...daemonProjectState.readPaths.filter((path: string) => path !== daemonProjectState.writeFolderPath),
    ]
}

export async function getReadPaths(): Promise<readonly FilePath[]> {
    return (await getProjectState()).readPaths
}

export async function getWriteFolderPath(): Promise<O.Option<FilePath>> {
    try {
        return O.some((await getProjectState()).writeFolderPath)
    } catch {
        return O.none
    }
}

/**
 * Create a fresh dated voicetree folder, make it the sole loaded folder, and
 * point new-node creation at it ("New voicetree" button).
 *
 * Clean-slate semantics: switching the write folder to the new (empty) dated
 * folder demotes the previous write folder to a read path; we then unload every
 * remaining read path (the demoted previous write folder AND any folders that
 * were loaded as reads). The result is a graph showing only the freshly created
 * voicetree — the user starts from a blank canvas rather than carrying the
 * previous project's nodes across.
 *
 * The write switch and each unload go through the canonical folder-state
 * mutators (`setWriteFolderPathThroughDaemon` / `removeReadPathThroughDaemon`),
 * which drive the daemon's session folder-state transitions and push the
 * updated projected graph to the renderer.
 */
export async function createDatedVoiceTreeFolder(): Promise<{
    success: boolean
    path?: string
    error?: string
}> {
    try {
        const watchedDir: string = (await getProjectState()).projectRoot
        const newPath: string = await createDatedSubfolder(watchedDir)

        // Make the new dated folder the write folder. This loads it and demotes
        // the previous write folder into the read paths (also re-points the
        // Python text-to-tree server at the new folder via notifyWriteDirectory).
        await setWriteFolderPathThroughDaemon(newPath)

        // Unload everything else: every read path other than the new write
        // folder — which now includes the demoted previous write folder and any
        // previously loaded read folders — leaving the new voicetree alone.
        const stateAfterSwitch: ProjectState = await getProjectState()
        for (const readPath of stateAfterSwitch.readPaths) {
            if (readPath !== stateAfterSwitch.writeFolderPath) {
                await removeReadPathThroughDaemon(readPath)
            }
        }

        await refreshMainGraphFromDaemon()
        return { success: true, path: newPath }
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
    }
}

// Re-export the shared mkdir-under-parent op (also used by VTD's gateway).
export { createSubfolder } from '@vt/app-config/folders'

