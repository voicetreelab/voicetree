import type { FSWatcher } from 'chokidar'
import type { FilePath } from '@vt/graph-model/graph'
import { getProjectRoot, type ProjectRootResponse } from '@vt/graph-db-client'

import {
    getActiveDaemonConnection,
    type CachedDaemonConnection,
} from '@/shell/edge/main/electron/graph-daemon'

let watcher: FSWatcher | null = null
let projectRootWatchedDirectory: FilePath | null = null
let startupFolderOverride: string | null = null
let onFolderSwitchCleanup: (() => void) | null = null

export function getWatcher(): FSWatcher | null {
    return watcher
}

export function setWatcher(w: FSWatcher | null): void {
    watcher = w
}

export function getProjectRootWatchedDirectory(): FilePath | null {
    return projectRootWatchedDirectory
}

export async function getProjectRootWatchedDirectoryFromDaemon(): Promise<FilePath | null> {
    const connection: CachedDaemonConnection | null = getActiveDaemonConnection()
    if (!connection) {
        return projectRootWatchedDirectory
    }

    try {
        const response: ProjectRootResponse = await getProjectRoot(connection.client.baseUrl)
        return response.projectRoot ?? projectRootWatchedDirectory
    } catch {
        return projectRootWatchedDirectory
    }
}

export function setProjectRootWatchedDirectory(dir: FilePath | null): void {
    projectRootWatchedDirectory = dir
}

export function getStartupFolderOverride(): string | null {
    return startupFolderOverride
}

export function setStartupFolderOverride(folderPath: string | null): void {
    startupFolderOverride = folderPath
}

export function getOnFolderSwitchCleanup(): (() => void) | null {
    return onFolderSwitchCleanup
}

export function setOnFolderSwitchCleanup(cleanup: (() => void) | null): void {
    onFolderSwitchCleanup = cleanup
}

export function clearWatchFolderState(): void {
    watcher = null
    projectRootWatchedDirectory = null
    startupFolderOverride = null
    onFolderSwitchCleanup = null
}
