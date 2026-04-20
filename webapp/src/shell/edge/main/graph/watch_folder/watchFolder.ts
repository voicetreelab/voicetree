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
    getWritePath,
    initialLoad as initialLoadImpl,
    loadFolder as loadFolderImpl,
    loadPreviousFolder as loadPreviousFolderImpl,
    markFrontendReady as markFrontendReadyImpl,
    removeReadPath,
    setProjectRootWatchedDirectory,
    setVaultPath,
    setWritePath,
    startFileWatching as startFileWatchingImpl,
    stopFileWatching as stopFileWatchingImpl,
    type WatchFolderLoadOptions,
} from '@vt/graph-model'

import {
    isDaemonGraphSyncActive,
    startDaemonGraphSync,
    stopDaemonGraphSync,
} from '@/shell/edge/main/electron/daemon-watch-sync'
import { syncWatchedProjectRoot } from '@/shell/edge/main/state/live-state-store'

const DAEMON_LOAD_OPTIONS: WatchFolderLoadOptions = {
    mountWatcher: false,
}

function syncLoadedRoot(directory?: string): void {
    syncWatchedProjectRoot(directory ?? getProjectRootWatchedDirectory())
}

async function startDaemonSyncForLoadedDirectory(directory?: string): Promise<void> {
    const loadedDirectory: string | null = directory ?? getProjectRootWatchedDirectory()
    if (!loadedDirectory) {
        syncLoadedRoot()
        return
    }

    await startDaemonGraphSync(loadedDirectory)
    syncLoadedRoot(loadedDirectory)
}

export async function initialLoad(): Promise<void> {
    await initialLoadImpl(DAEMON_LOAD_OPTIONS)
    await startDaemonSyncForLoadedDirectory()
}

export async function loadFolder(
    watchedFolderPath: FilePath,
): Promise<{ readonly success: boolean }> {
    const result = await loadFolderImpl(watchedFolderPath, DAEMON_LOAD_OPTIONS)
    if (result.success) {
        await startDaemonSyncForLoadedDirectory(watchedFolderPath)
    }
    return result
}

export async function startFileWatching(
    directoryPath?: string,
): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    const result = await startFileWatchingImpl(directoryPath, DAEMON_LOAD_OPTIONS)
    if (result.success && result.directory) {
        await startDaemonSyncForLoadedDirectory(result.directory)
    }
    return result
}

export async function stopFileWatching(): Promise<{ readonly success: boolean; readonly error?: string }> {
    await stopDaemonGraphSync()
    const result = await stopFileWatchingImpl()
    setProjectRootWatchedDirectory(null)
    if (result.success) {
        syncWatchedProjectRoot(null)
    }
    return result
}

export function getWatchStatus(): { readonly isWatching: boolean; readonly directory: string | undefined } {
    const directory: string | undefined = getProjectRootWatchedDirectory() ?? undefined
    return {
        isWatching: directory !== undefined && isDaemonGraphSyncActive(),
        directory,
    }
}

export function isWatching(): boolean {
    return getWatchStatus().isWatching
}

export async function loadPreviousFolder(): Promise<{
    readonly success: boolean
    readonly directory?: string
    readonly error?: string
}> {
    const result = await loadPreviousFolderImpl(DAEMON_LOAD_OPTIONS)
    if (result.success && result.directory) {
        await startDaemonSyncForLoadedDirectory(result.directory)
    }
    return result
}

export async function markFrontendReady(): Promise<void> {
    await markFrontendReadyImpl(DAEMON_LOAD_OPTIONS)
    await startDaemonSyncForLoadedDirectory()
}

export {
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
