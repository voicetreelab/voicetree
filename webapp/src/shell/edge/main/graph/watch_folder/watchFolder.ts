import path from 'node:path'
import { promises as fs } from 'node:fs'
import * as O from 'fp-ts/lib/Option.js'
import { getCallbacks, type FilePath } from '@vt/graph-model'
import { getAvailableFolders, parseSearchQuery, toAbsolutePath } from '@vt/graph-model'
import type { AbsolutePath, AvailableFolderItem } from '@vt/graph-model'
import type { ParsedQuery } from '@vt/graph-model'
import {
    getProjectRootWatchedDirectory,
    getStartupFolderOverride,
    getOnFolderSwitchCleanup,
    setProjectRootWatchedDirectory,
} from '@/shell/edge/main/state/watch-folder-store'
import { initializeProject } from '@vt/app-config/project'
import { createDatedSubfolder } from '@vt/app-config/project'
import {
    getLastDirectory,
    getVaultConfigForDirectory,
    saveLastDirectory,
    saveVaultConfigForDirectory,
} from '@vt/app-config/vault-config'

import {
    isDaemonGraphSyncActive,
    startDaemonGraphSync,
    stopDaemonGraphSync,
} from '@/shell/edge/main/electron/daemon-watch-sync'
import {
    markLoadTiming,
    startLoadTiming,
} from '@/shell/edge/main/diagnostics/loadTiming'
import { getActiveDaemonVaultState } from '@/shell/edge/main/electron/daemon-ipc-proxy'
import {
    ensureDaemonClientForVault,
    type CachedDaemonConnection,
} from '@/shell/edge/main/electron/graph-daemon'
import { writeCurrentPositionsThroughDaemon } from '@/shell/edge/main/electron/daemon-graph-queries'
import { syncWatchedProjectRoot } from '@/shell/edge/main/state/live-state-store'
import type { VaultState } from '@vt/graph-db-client'
import {
    getSubfoldersWithModifiedAt,
    isValidSubdirectory,
} from '@/shell/edge/main/graph/watch_folder/folderScanning'

const configuredDaemonLoadTimeoutMs: number = Number.parseInt(
    process.env.VOICETREE_DAEMON_LOAD_TIMEOUT_MS ?? '',
    10,
)
const DAEMON_LOAD_TIMEOUT_MS: number = Number.isFinite(configuredDaemonLoadTimeoutMs)
    ? configuredDaemonLoadTimeoutMs
    : process.env.CI ? 45_000 : 15_000

function syncLoadedRoot(directory?: string): void {
    syncWatchedProjectRoot(directory ?? getProjectRootWatchedDirectory())
}

export async function getAvailableFoldersForSelector(
    searchQuery: string,
): Promise<readonly AvailableFolderItem[]> {
    const projectRoot: string | null = getProjectRootWatchedDirectory()
    if (!projectRoot) {
        return []
    }

    const loadedPaths: readonly AbsolutePath[] =
        (await getVaultPaths()).map((p: string) => toAbsolutePath(p))
    const parsed: ParsedQuery = parseSearchQuery(searchQuery)

    if (parsed.isAbsolute && parsed.basePath) {
        try {
            const stat = await fs.stat(parsed.basePath)
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

async function pathIsDirectory(directoryPath: string): Promise<boolean> {
    try {
        return (await fs.stat(directoryPath)).isDirectory()
    } catch {
        return false
    }
}

function resolveLocalWritePath(projectPath: string, writePath: string): string {
    return path.isAbsolute(writePath)
        ? writePath
        : path.join(projectPath, writePath)
}

async function resolveOrCreateWritePath(projectPath: string): Promise<string> {
    const existingConfig = await getVaultConfigForDirectory(projectPath)
    if (existingConfig?.writePath) {
        const writePath: string = resolveLocalWritePath(projectPath, existingConfig.writePath)
        if (await pathIsDirectory(writePath)) {
            return writePath
        }
    }

    const onboardingRoot: string | undefined = getCallbacks().getOnboardingDirectory?.()
    const onboardingSourceDir: string | undefined = onboardingRoot
        ? path.join(onboardingRoot, 'voicetree')
        : undefined
    const initializedPath: string | null = await initializeProject(projectPath, onboardingSourceDir)
    const writePath: string = initializedPath ?? projectPath
    await saveVaultConfigForDirectory(projectPath, { writePath })
    return writePath
}

async function startDaemonSyncForLoadedDirectory(directory?: string): Promise<void> {
    const loadedDirectory: string | null = directory ?? getProjectRootWatchedDirectory()
    if (!loadedDirectory) {
        syncLoadedRoot()
        return
    }

    await ensureDaemonClientForVault(loadedDirectory, {
        timeoutMs: DAEMON_LOAD_TIMEOUT_MS,
    })
    await startDaemonGraphSync(loadedDirectory)
    syncLoadedRoot(loadedDirectory)
}

let inflightInitialLoad: Promise<void> | null = null

export async function initialLoad(): Promise<void> {
    if (getProjectRootWatchedDirectory() !== null) {
        return
    }
    if (inflightInitialLoad) {
        return inflightInitialLoad
    }

    const pending: Promise<void> = doInitialLoad()
    inflightInitialLoad = pending
    try {
        await pending
    } finally {
        if (inflightInitialLoad === pending) {
            inflightInitialLoad = null
        }
    }
}

async function doInitialLoad(): Promise<void> {
    const startupFolder: string | null = getStartupFolderOverride()
    if (startupFolder !== null) {
        await loadFolder(startupFolder)
        return
    }

    const lastDirectory: O.Option<string> = await getLastDirectory()
    if (getProjectRootWatchedDirectory() !== null) {
        return
    }
    if (O.isSome(lastDirectory)) {
        await loadFolder(lastDirectory.value)
    }
}

const inflightLoadByPath: Map<string, Promise<{ readonly success: boolean }>> = new Map()

export async function loadFolder(
    watchedFolderPath: FilePath,
): Promise<{ readonly success: boolean }> {
    if (!(await pathIsDirectory(watchedFolderPath))) {
        return { success: false }
    }

    // Idempotency: opening a project that is already the active project is a
    // no-op. Three independent code paths (renderer bootstrap, UI click,
    // startFileWatching IPC) can each request the same load. Without this
    // short-circuit, the second/third arrival re-spawns vt-graphd and clears
    // the graph view that the first load just populated.
    if (
        getProjectRootWatchedDirectory() === watchedFolderPath
        && isDaemonGraphSyncActive()
    ) {
        process.stdout.write(
            `[load-timing] ts=${new Date().toISOString()} event=loadFolder:already-loaded dir=${watchedFolderPath}\n`,
        )
        return { success: true }
    }

    const existing: Promise<{ readonly success: boolean }> | undefined =
        inflightLoadByPath.get(watchedFolderPath)
    if (existing) {
        process.stdout.write(
            `[load-timing] ts=${new Date().toISOString()} event=loadFolder:dedupe-hit dir=${watchedFolderPath}\n`,
        )
        return existing
    }

    const pending: Promise<{ readonly success: boolean }> = doLoadFolder(watchedFolderPath)
    inflightLoadByPath.set(watchedFolderPath, pending)
    try {
        return await pending
    } finally {
        if (inflightLoadByPath.get(watchedFolderPath) === pending) {
            inflightLoadByPath.delete(watchedFolderPath)
        }
    }
}

async function doLoadFolder(
    watchedFolderPath: FilePath,
): Promise<{ readonly success: boolean }> {
    startLoadTiming(watchedFolderPath)

    const previousRoot: FilePath | null = getProjectRootWatchedDirectory()
    if (previousRoot) {
        await writeCurrentPositionsThroughDaemon()
    }

    setProjectRootWatchedDirectory(watchedFolderPath)
    void getCallbacks().enableMcpIntegration?.().catch(() => { /* MCP server may not be ready yet */ })

    const folderCleanup: (() => void) | null = getOnFolderSwitchCleanup()
    folderCleanup?.()
    getCallbacks().onGraphCleared?.()

    const writePath: string = await resolveOrCreateWritePath(watchedFolderPath)
    await getCallbacks().ensureProjectSetup?.(watchedFolderPath).catch((error: unknown) => {
        console.warn('[loadFolder] Failed to set up .voicetree/ defaults:', error)
    })

    markLoadTiming('main:daemon-ensure-start')
    const connection: CachedDaemonConnection = await ensureDaemonClientForVault(watchedFolderPath, {
        timeoutMs: DAEMON_LOAD_TIMEOUT_MS,
    })
    markLoadTiming('main:daemon-ensure-end', {
        port: connection.port,
        launched: connection.launched,
    })
    await connection.client.setWritePath(writePath)
    markLoadTiming('main:daemon-set-write-path-end')
    await startDaemonSyncForLoadedDirectory(watchedFolderPath)
    markLoadTiming('main:daemon-graph-sync-started')
    await saveLastDirectory(watchedFolderPath)

    getCallbacks().onWatchingStarted?.({
        directory: watchedFolderPath,
        writePath,
        timestamp: new Date().toISOString(),
    })

    return { success: true }
}

export async function startFileWatching(
    directoryPath?: string,
): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    const selectedDirectory: string | undefined = directoryPath
        ?? await getCallbacks().openFolderDialog?.()

    if (!selectedDirectory) {
        return { success: false, error: 'No new directory selected' }
    }
    if (!(await pathIsDirectory(selectedDirectory))) {
        return { success: false, error: `Path is not a directory: ${selectedDirectory}` }
    }

    const result: { readonly success: boolean } = await loadFolder(selectedDirectory)
    return result.success
        ? { success: true, directory: selectedDirectory }
        : { success: false, error: 'Failed to load folder' }
}

export async function stopFileWatching(): Promise<{ readonly success: boolean; readonly error?: string }> {
    await stopDaemonGraphSync()
    setProjectRootWatchedDirectory(null)
    syncWatchedProjectRoot(null)
    getCallbacks().onFolderCleared?.()
    return { success: true }
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
    await initialLoad()
    const watchedDir: string | null = getProjectRootWatchedDirectory()
    return watchedDir
        ? { success: true, directory: watchedDir }
        : { success: false, error: 'No previous folder found' }
}

export async function markFrontendReady(): Promise<void> {
    await initialLoad()
}

export async function getVaultPaths(): Promise<readonly FilePath[]> {
    const daemonVaultState: VaultState | null = await getActiveDaemonVaultState()
    if (daemonVaultState) {
        return [
            daemonVaultState.writePath,
            ...daemonVaultState.readPaths.filter((path: string) => path !== daemonVaultState.writePath),
        ]
    }

    const writePath: O.Option<FilePath> = await getWritePath()
    return O.isSome(writePath) ? [writePath.value] : []
}

export async function getReadPaths(): Promise<readonly FilePath[]> {
    const daemonVaultState: VaultState | null = await getActiveDaemonVaultState()
    if (daemonVaultState) {
        return daemonVaultState.readPaths
    }

    return []
}

export async function getWritePath(): Promise<O.Option<FilePath>> {
    const daemonVaultState: VaultState | null = await getActiveDaemonVaultState()
    if (daemonVaultState) {
        return O.some(daemonVaultState.writePath)
    }

    const watchedDir: FilePath | null = getProjectRootWatchedDirectory()
    if (!watchedDir) {
        return O.none
    }
    const config = await getVaultConfigForDirectory(watchedDir)
    return O.some(config?.writePath ? resolveLocalWritePath(watchedDir, config.writePath) : watchedDir)
}

export function getVaultPath(): O.Option<FilePath> {
    return O.fromNullable(getProjectRootWatchedDirectory())
}

export function setVaultPath(vaultPath: FilePath): void {
    setProjectRootWatchedDirectory(vaultPath)
}

export function clearVaultPath(): void {
    setProjectRootWatchedDirectory(null)
}

export async function createDatedVoiceTreeFolder(): Promise<{
    success: boolean
    path?: string
    error?: string
}> {
    const watchedDir: string | null = getProjectRootWatchedDirectory()
    if (!watchedDir) {
        return { success: false, error: 'No project open' }
    }

    try {
        const previousVaultState: VaultState | null = await getActiveDaemonVaultState()
        const newPath: string = await createDatedSubfolder(watchedDir)
        const connection: CachedDaemonConnection = await ensureDaemonClientForVault(watchedDir, {
            timeoutMs: DAEMON_LOAD_TIMEOUT_MS,
        })
        await connection.client.addReadPath(newPath)
        await connection.client.setWritePath(newPath)
        if (
            previousVaultState?.writePath
            && previousVaultState.writePath !== newPath
            && previousVaultState.writePath !== watchedDir
        ) {
            await connection.client.removeReadPath(previousVaultState.writePath).catch(() => undefined)
        }
        await startDaemonSyncForLoadedDirectory(watchedDir)
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
