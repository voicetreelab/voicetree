import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Stats } from 'node:fs'
import * as O from 'fp-ts/lib/Option.js'
import { getCallbacks, getAvailableFolders, parseSearchQuery, toAbsolutePath } from '@vt/graph-model'
import type { AbsolutePath, AvailableFolderItem, FilePath } from '@vt/graph-model'
import type { ParsedQuery } from '@vt/graph-model'
import { createDatedSubfolder } from '@vt/app-config/project'
import type { VaultState } from '@vt/graph-db-client'
import { getSubfoldersWithModifiedAt, isValidSubdirectory } from '@/shell/edge/main/graph/watch_folder/folderScanning'
import { stopDaemonGraphSync } from '@/shell/edge/main/runtime/electron/daemon/sync/daemon-watch-sync'
import { callDaemon } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'
import {
    getStartupVaultHint,
    openVault,
} from './openVault'

export { getStartupVaultHint, openVault }

async function getVaultState(): Promise<VaultState> {
    return await callDaemon((client) => client.getVault())
}

async function getActiveProjectRoot(): Promise<string | null> {
    try {
        return (await getVaultState()).projectRoot
    } catch {
        return null
    }
}

export async function getAvailableFoldersForSelector(
    searchQuery: string,
): Promise<readonly AvailableFolderItem[]> {
    const projectRoot: string | null = await getActiveProjectRoot()
    if (!projectRoot) {
        return []
    }

    const loadedPaths: readonly AbsolutePath[] =
        (await getVaultPaths()).map((p: string) => toAbsolutePath(p))
    const parsed: ParsedQuery = parseSearchQuery(searchQuery)

    if (parsed.isAbsolute && parsed.basePath) {
        try {
            const stat: Stats = await fs.stat(parsed.basePath)
            if (!stat.isDirectory()) {
                return []
            }
        } catch {
            return []
        }

        const subfolders: readonly { path: AbsolutePath; modifiedAt: number }[] =
            await getSubfoldersWithModifiedAt(toAbsolutePath(parsed.basePath))
        return getAvailableFolders(
            toAbsolutePath(parsed.basePath),
            loadedPaths,
            subfolders,
            searchQuery,
            parsed.filterText,
        )
    }

    let scanRoot: AbsolutePath
    let filterText: string
    if (parsed.basePath) {
        const targetPath: string = path.join(projectRoot, parsed.basePath)
        if (!(await isValidSubdirectory(projectRoot, targetPath))) {
            return []
        }
        scanRoot = toAbsolutePath(targetPath)
        filterText = parsed.filterText
    } else {
        scanRoot = toAbsolutePath(projectRoot)
        filterText = searchQuery
    }

    const subfolders: readonly { path: AbsolutePath; modifiedAt: number }[] =
        await getSubfoldersWithModifiedAt(scanRoot)
    return getAvailableFolders(
        toAbsolutePath(projectRoot),
        loadedPaths,
        subfolders,
        searchQuery,
        filterText,
    )
}

export async function stopFileWatching(): Promise<{ readonly success: boolean; readonly error?: string }> {
    try {
        await stopDaemonGraphSync()
        await callDaemon((client) => client.closeVault())
        getCallbacks().onFolderCleared?.()
        return { success: true }
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
    }
}

export async function getWatchStatus(): Promise<{ readonly isWatching: boolean; readonly directory: string | undefined }> {
    try {
        const vaultState: VaultState = await getVaultState()
        return {
            isWatching: true,
            directory: vaultState.projectRoot,
        }
    } catch {
        return { isWatching: false, directory: undefined }
    }
}

export async function isWatching(): Promise<boolean> {
    return (await getWatchStatus()).isWatching
}

export async function getVaultPaths(): Promise<readonly FilePath[]> {
    const daemonVaultState: VaultState = await getVaultState()
    return [
        daemonVaultState.writeFolderPath,
        ...daemonVaultState.readPaths.filter((path: string) => path !== daemonVaultState.writeFolderPath),
    ]
}

export async function getReadPaths(): Promise<readonly FilePath[]> {
    return (await getVaultState()).readPaths
}

export async function getWriteFolderPath(): Promise<O.Option<FilePath>> {
    try {
        return O.some((await getVaultState()).writeFolderPath)
    } catch {
        return O.none
    }
}

export async function createDatedVoiceTreeFolder(): Promise<{
    success: boolean
    path?: string
    error?: string
}> {
    try {
        const previousVaultState: VaultState = await getVaultState()
        const watchedDir: string = previousVaultState.projectRoot
        const newPath: string = await createDatedSubfolder(watchedDir)
        await callDaemon(async (client) => {
            await client.addReadPath(newPath)
            return await client.setWriteFolderPath(newPath)
        })

        if (
            previousVaultState.writeFolderPath
            && previousVaultState.writeFolderPath !== newPath
            && previousVaultState.writeFolderPath !== watchedDir
        ) {
            await callDaemon((client) => client.removeReadPath(previousVaultState.writeFolderPath)).catch(() => undefined)
        }

        return { success: true, path: newPath }
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
    }
}

export async function createSubfolder(
    parentPath: string,
    folderName: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
    if (!folderName || folderName.includes('/') || folderName.includes('\\')) {
        return { success: false, error: 'Invalid folder name' }
    }
    const fullPath: string = path.join(parentPath, folderName)
    try {
        await fs.mkdir(fullPath, { recursive: true })
        return { success: true, path: fullPath }
    } catch (error) {
        const message: string = error instanceof Error ? error.message : String(error)
        return { success: false, error: message }
    }
}

