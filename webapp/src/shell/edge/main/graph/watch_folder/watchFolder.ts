import type { FilePath } from '@vt/graph-model'
import {
    addReadPath,
    clearVaultPath,
    createDatedVoiceTreeFolder,
    createSubfolder,
    getAvailableFoldersForSelector,
    getProjectRootWatchedDirectory,
    getReadPaths,
    getVaultPath,
    getVaultPaths,
    getWatchStatus,
    getWritePath,
    initialLoad as initialLoadImpl,
    isWatching,
    loadFolder as loadFolderImpl,
    loadPreviousFolder as loadPreviousFolderImpl,
    markFrontendReady as markFrontendReadyImpl,
    removeReadPath,
    setVaultPath,
    setWritePath,
    startFileWatching as startFileWatchingImpl,
    stopFileWatching as stopFileWatchingImpl,
} from '@vt/graph-model'

import { syncWatchedProjectRoot } from '@/shell/edge/main/state/live-state-store'

function syncLoadedRoot(directory?: string): void {
    syncWatchedProjectRoot(directory ?? getProjectRootWatchedDirectory())
}

export async function initialLoad(): Promise<void> {
    await initialLoadImpl()
    syncLoadedRoot()
}

export async function loadFolder(
    watchedFolderPath: FilePath,
): Promise<{ readonly success: boolean }> {
    const result = await loadFolderImpl(watchedFolderPath)
    if (result.success) {
        syncLoadedRoot(watchedFolderPath)
    }
    return result
}

export async function startFileWatching(
    directoryPath?: string,
): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    const result = await startFileWatchingImpl(directoryPath)
    if (result.success) {
        syncLoadedRoot(result.directory)
    }
    return result
}

export async function stopFileWatching(): Promise<{ readonly success: boolean; readonly error?: string }> {
    const result = await stopFileWatchingImpl()
    if (result.success) {
        syncWatchedProjectRoot(null)
    }
    return result
}

export async function loadPreviousFolder(): Promise<{
    readonly success: boolean
    readonly directory?: string
    readonly error?: string
}> {
    const result = await loadPreviousFolderImpl()
    if (result.success) {
        syncLoadedRoot(result.directory)
    }
    return result
}

export async function markFrontendReady(): Promise<void> {
    await markFrontendReadyImpl()
    syncLoadedRoot()
}

export {
    getWatchStatus,
    isWatching,
    getVaultPaths,
    getReadPaths,
    getWritePath,
    setWritePath,
    addReadPath,
    removeReadPath,
    getVaultPath,
    setVaultPath,
    clearVaultPath,
    createDatedVoiceTreeFolder,
    createSubfolder,
    getAvailableFoldersForSelector,
}
