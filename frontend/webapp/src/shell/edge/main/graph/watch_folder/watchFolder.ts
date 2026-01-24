/**
 * Watch folder orchestration.
 *
 * This module coordinates folder loading and file watching:
 * - Initial load on app start
 * - Switching between folders
 * - Starting/stopping file watching
 *
 * Extracted modules:
 * - voicetree-config-io.ts: Config persistence
 * - vault-allowlist.ts: Allowlist management
 * - file-watcher-setup.ts: File watcher setup
 */

import { loadGraphFromDisk, loadGraphFromDiskWithLazyLoading, resolveLinkedNodesInWatchedFolder } from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk";
import type { FilePath, Graph, GraphDelta } from "@/pure/graph";
import { applyGraphDeltaToGraph, mapNewGraphToDelta } from "@/pure/graph";
import type { FileLimitExceededError } from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce";
import { setGraph } from "@/shell/edge/main/state/graph-store";
import { dialog } from "electron";
import path from "path";
import * as O from "fp-ts/lib/Option.js";
import * as E from "fp-ts/lib/Either.js";
import { promises as fs } from "fs";
import fsSync from "fs";
import type { FSWatcher } from "chokidar";
import { getMainWindow } from "@/shell/edge/main/state/app-electron-state";
import { notifyTextToTreeServerOfDirectory } from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/notifyTextToTreeServerOfDirectory";
import { getOnboardingDirectory } from "@/shell/edge/main/electron/onboarding-setup";
import {
    broadcastGraphDeltaToUI
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI";
import { loadSettings } from "@/shell/edge/main/settings/settings_IO";
import { type VTSettings } from "@/pure/settings/types";
import {
    getWatcher,
    setWatcher,
    getWatchedDirectory,
    setWatchedDirectory,
    getStartupFolderOverride,
    setStartupFolderOverride as setStartupFolderOverrideStore,
    getOnFolderSwitchCleanup,
    setOnFolderSwitchCleanup as setOnFolderSwitchCleanupStore,
} from "@/shell/edge/main/state/watch-folder-store";

// Import from extracted modules
import {
    getLastDirectory,
    saveLastDirectory,
    saveVaultConfigForDirectory,
} from "./voicetree-config-io";
import {
    resolveAllowlistForProject,
} from "./vault-allowlist";
import { setupWatcher } from "./file-watcher-setup";
import { acquireFolderLock, releaseFolderLock } from "./folder-lock";
import { createStarterNode } from "./create-starter-node";
// Re-export for app quit cleanup
export { releaseCurrentLock } from "./folder-lock";

// Re-exports for backward compatibility
export { getWatchedDirectory } from "@/shell/edge/main/state/watch-folder-store";
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
} from "./vault-allowlist";

// CLI argument override for opening a specific folder on startup (used by "Open Folder in New Instance")
// Re-export for backward compatibility - delegates to store
export function setStartupFolderOverride(folderPath: string): void {
    setStartupFolderOverrideStore(folderPath);
}

// Re-export for backward compatibility - delegates to store
export function setOnFolderSwitchCleanup(cleanup: () => void): void {
    setOnFolderSwitchCleanupStore(cleanup);
}

export async function initialLoad(): Promise<void> {
    // Check for CLI-specified folder first (from "Open Folder in New Instance")
    const startupFolder: string | null = getStartupFolderOverride();
    if (startupFolder !== null) {
        await loadFolder(startupFolder);
        return;
    }

    const lastDirectory: O.Option<string> = await getLastDirectory();
    if (O.isSome(lastDirectory)) {
        await loadFolder(lastDirectory.value);
    } else {
        // First run: load onboarding directory
        const onboardingPath: string = getOnboardingDirectory();
        await loadFolder(onboardingPath);
    }
}

// Generate date-based subfolder name: voicetree-{day}-{month}
function generateDateSubfolder(): string {
    const now: Date = new Date();
    return `voicetree-${now.getDate()}-${now.getMonth() + 1}`;
}

export async function loadFolder(watchedFolderPath: FilePath): Promise<{ success: boolean }> {
    // TODO: Save current graph positions before switching folders (writeAllPositionsSync)
    // IMPORTANT: watchedFolderPath is the folder the human chooses for the project
    // writePath (from vaultConfig) is where new files are created

    //console.log('[loadFolder] Starting for path:', watchedFolderPath);

    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) {
        console.error('No main window available');
        return { success: false };
    }

    // Release any existing lock before switching folders
    const previousWatchedDir: string | null = getWatchedDirectory();
    if (previousWatchedDir && previousWatchedDir !== watchedFolderPath) {
        await releaseFolderLock(previousWatchedDir);
    }

    // Acquire lock for the new folder (overwrites any stale locks from crashes)
    await acquireFolderLock(watchedFolderPath);

    // Update watchedDirectory FIRST
    setWatchedDirectory(watchedFolderPath);

    // Close old watcher before attempting to load new folder
    const oldWatcher: FSWatcher | null = getWatcher();
    if (oldWatcher) {
        await oldWatcher.close();
        setWatcher(null);
    }

    // Clean up terminals and other resources before switching folders
    const folderCleanup: (() => void) | null = getOnFolderSwitchCleanup();
    if (folderCleanup) {
        //console.log('[loadFolder] Running folder switch cleanup (terminals, etc.)');
        folderCleanup();
    }

    // Clear existing graph state in UI-edge before loading new folder
    if (!mainWindow.isDestroyed()) {
        //console.log('[loadFolder] Sending graph:clear event to UI-edge');
        mainWindow.webContents.send('graph:clear');
    }

    // Try to resolve from saved vaultConfig first
    const savedConfig: { allowlist: readonly string[]; writePath: string; readPaths: readonly string[] } | null = await resolveAllowlistForProject(watchedFolderPath);

    if (savedConfig) {
        // Use saved config with lazy loading
        // Only writePath is loaded immediately, readPaths are lazy-loaded
        const immediateLoadPaths: readonly string[] = [savedConfig.writePath];
        const lazyLoadPaths: readonly string[] = savedConfig.readPaths;

        const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDiskWithLazyLoading(
            immediateLoadPaths,
            lazyLoadPaths
        );

        if (E.isLeft(loadResult)) {
            // Config exists but file limit exceeded - show error
            void dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: 'File Limit Exceeded',
                message: `This folder has ${loadResult.left.fileCount} markdown files, which exceeds the limit of 300.`,
                buttons: ['OK']
            });
            return { success: false };
        }

        return finishLoading(loadResult.right, savedConfig, watchedFolderPath, mainWindow);
    }

    // No saved config - try loading the directory directly
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([watchedFolderPath]);

    if (E.isRight(loadResult)) {
        // Success - build default allowlist and save config
        const allowlist: string[] = [watchedFolderPath];

        // Add paths from global default patterns (if folders exist)
        const settings: VTSettings = await loadSettings();
        const patterns: readonly string[] = settings.defaultAllowlistPatterns ?? [];
        for (const pattern of patterns) {
            const patternPath: string = path.join(watchedFolderPath, pattern);
            try {
                await fs.access(patternPath);
                if (!allowlist.includes(patternPath)) {
                    allowlist.push(patternPath);
                }
            } catch {
                // Pattern folder doesn't exist, skip
            }
        }

        const readPaths: readonly string[] = allowlist.filter(p => p !== watchedFolderPath);
        const newConfig: { allowlist: readonly string[]; writePath: string; readPaths: readonly string[] } = {
            allowlist,
            writePath: watchedFolderPath,
            readPaths
        };
        // Convert to VaultConfig structure for saving
        await saveVaultConfigForDirectory(watchedFolderPath, {
            writePath: watchedFolderPath,
            readPaths
        });

        return finishLoading(loadResult.right, newConfig, watchedFolderPath, mainWindow);
    }

    // File limit exceeded and no config - auto-create subfolder
    const fileCount: number = loadResult.left.fileCount;
    //console.log('[loadFolder] File limit exceeded:', fileCount, 'files. Creating subfolder.');

    const subfolder: string = generateDateSubfolder();
    const subfolderPath: string = path.join(watchedFolderPath, subfolder);

    // Create the subfolder
    await fs.mkdir(subfolderPath, { recursive: true });

    // Build allowlist with the new subfolder as write path
    const allowlist: string[] = [subfolderPath];

    // Add global patterns
    const settings: VTSettings = await loadSettings();
    const patterns: readonly string[] = settings.defaultAllowlistPatterns ?? [];
    for (const pattern of patterns) {
        const patternPath: string = path.join(watchedFolderPath, pattern);
        try {
            await fs.access(patternPath);
            if (!allowlist.includes(patternPath)) {
                allowlist.push(patternPath);
            }
        } catch {
            // Pattern folder doesn't exist, skip
        }
    }

    // Save config with subfolder as writePath
    const subfolderReadOnLinkPaths: readonly string[] = allowlist.filter(p => p !== subfolderPath);
    const newConfig: { allowlist: readonly string[]; writePath: string; readPaths: readonly string[] } = {
        allowlist,
        writePath: subfolderPath,
        readPaths: subfolderReadOnLinkPaths
    };
    // Convert to VaultConfig structure for saving
    await saveVaultConfigForDirectory(watchedFolderPath, {
        writePath: subfolderPath,
        readPaths: subfolderReadOnLinkPaths
    });

    // Show info dialog (non-blocking)
    void dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'New Workspace Created',
        message: `This folder has ${fileCount} markdown files.\n\nCreated new workspace:\n${subfolderPath}`,
        buttons: ['OK']
    });

    // Load from the new allowlist (empty subfolder initially)
    const retryResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(allowlist);

    if (E.isLeft(retryResult)) {
        // Still exceeds limit (shouldn't happen with empty subfolder)
        void dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'File Limit Exceeded',
            message: `Unable to create workspace. File count: ${retryResult.left.fileCount}`,
            buttons: ['OK']
        });
        return { success: false };
    }

    return finishLoading(retryResult.right, newConfig, watchedFolderPath, mainWindow);
}

/**
 * Complete the folder loading process after graph is loaded.
 */
async function finishLoading(
    graph: Graph,
    config: { allowlist: readonly string[]; writePath: string; readPaths: readonly string[] },
    watchedFolderPath: FilePath,
    mainWindow: Electron.CrossProcessExports.BrowserWindow
): Promise<{ success: boolean }> {
    let currentGraph: Graph = graph;
    //console.log('[loadFolder] Graph loaded from disk, node count:', Object.keys(currentGraph.nodes).length);

    // If folder is empty, create a starter node using the template from settings
    if (Object.keys(currentGraph.nodes).length === 0) {
        //console.log('[loadFolder] Empty folder detected, creating starter node');
        currentGraph = await createStarterNode(config.writePath);
    }

    // Resolve any wikilinks that point to files in the watched folder
    // This handles pre-existing links at load time (not just new links from file changes)
    const resolutionDelta: GraphDelta = await resolveLinkedNodesInWatchedFolder(currentGraph, watchedFolderPath);
    if (resolutionDelta.length > 0) {
        currentGraph = applyGraphDeltaToGraph(currentGraph, resolutionDelta);
    }
    //console.log('[loadFolder] Resolved linked nodes, node count:', Object.keys(currentGraph.nodes).length);

    // Update graph store directly (bypassing applyGraphDeltaToMemState to avoid double resolution)
    setGraph(currentGraph);

    // let backend know, call /load-directory non blocking
    notifyTextToTreeServerOfDirectory(config.writePath);

    // Broadcast initial graph to UI-edge (different event from incremental updates)
    const graphDelta: GraphDelta = mapNewGraphToDelta(currentGraph);
    //console.log('[loadFolder] Created graph delta, length:', graphDelta.length);

    // Initial load: broadcast directly to UI (skip applyGraphDeltaToMemState since graph is already set)
    broadcastGraphDeltaToUI(graphDelta);
    //console.log('[loadFolder] Graph delta broadcast to UI-edge');

    // Setup file watcher - watch all paths in allowlist, use watchedFolderPath as base for node IDs
    await setupWatcher(config.allowlist, watchedFolderPath);
    //console.log('[loadFolder] File watcher setup complete for', config.allowlist.length, 'vault paths');

    // Save as last directory for auto-start on next launch
    await saveLastDirectory(watchedFolderPath);

    // Notify UI that watching has started
    mainWindow.webContents.send('watching-started', {
        directory: getWatchedDirectory(),
        writePath: config.writePath,
        timestamp: new Date().toISOString()
    });

    return { success: true };
}

export function isWatching(): boolean {
    return getWatcher() !== null;
}

// API functions for file watching operations

export async function startFileWatching(directoryPath?: string): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    //console.log('[watchFolder] startFileWatching called, directoryPath:', directoryPath);

    // Get selected directory (either from param or via dialog)
    const getDirectory: () => Promise<string | null> = async (): Promise<string | null> => {
        if (directoryPath) {
            //console.log('[watchFolder] Using provided directory path:', directoryPath);
            return directoryPath;
        }

        //console.log('[watchFolder] No directory provided, showing dialog...');

        const result: Electron.OpenDialogReturnValue = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select Directory to Watch for Markdown Files',
            buttonLabel: 'Open',
            defaultPath: getWatchedDirectory() ?? process.env.HOME ?? '/'
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        return result.filePaths[0];
    };

    const selectedDirectory: string | null = await getDirectory();
    //console.log('[watchFolder] Selected directory:', selectedDirectory);

    if (!selectedDirectory) {
        //console.log('[watchFolder] No directory selected in picker, keeping same');
        return { success: false, error: 'No new directory selected' };
    }

    // FAIL FAST: Validate directory exists before proceeding
    //console.log('[watchFolder] Validating directory exists...');
    if (!fsSync.existsSync(selectedDirectory)) {
        const error: string = `Directory does not exist: ${selectedDirectory}`;
        console.error('[watchFolder] startFileWatching failed:', error);
        return { success: false, error };
    }

    //console.log('[watchFolder] Validating path is a directory...');
    if (!fsSync.statSync(selectedDirectory).isDirectory()) {
        const error: string = `Path is not a directory: ${selectedDirectory}`;
        console.error('[watchFolder] startFileWatching failed:', error);
        return { success: false, error };
    }

    //console.log('[watchFolder] Calling loadFolder...');
    await loadFolder(selectedDirectory);
    //console.log('[watchFolder] loadFolder completed successfully');
    return { success: true, directory: selectedDirectory };
}

export async function stopFileWatching(): Promise<{ readonly success: boolean; readonly error?: string }> {
    // Release folder lock before stopping
    const watchedDir: string | null = getWatchedDirectory();
    if (watchedDir) {
        await releaseFolderLock(watchedDir);
    }

    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        await currentWatcher.close();
        setWatcher(null);
        setWatchedDirectory(null);
    }
    return { success: true };
}

export function getWatchStatus(): { readonly isWatching: boolean; readonly directory: string | undefined } {
    const status: { isWatching: boolean; directory: string | undefined } = {
        isWatching: isWatching(),
        directory: getWatchedDirectory() ?? undefined
    };
    //console.log('Watch status:', status);
    return status;
}

export async function loadPreviousFolder(): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    //console.log('[watchFolder] loadPreviousFolder called');
    await initialLoad();
    const watchedDir: string | null = getWatchedDirectory();
    if (watchedDir) {
        //console.log('[watchFolder] Successfully loaded previous folder:', watchedDir);
        return { success: true, directory: watchedDir };
    } else {
        //console.log('[watchFolder] No previous folder found to load');
        return { success: false, error: 'No previous folder found' };
    }
}

/**
 * Called by renderer when frontend is ready to receive graph data.
 * Triggers initial folder load - main process decides what folder to load.
 */
export async function markFrontendReady(): Promise<void> {
    //console.log('[watchFolder] Frontend ready, loading initial folder...');
    await initialLoad();
}

