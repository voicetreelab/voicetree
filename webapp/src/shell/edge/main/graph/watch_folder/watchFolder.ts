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

import { loadGraphFromDisk, resolveLinkedNodesInWatchedFolder } from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk";
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
import { copyMarkdownFiles, pathExists, generateDateSubfolder, findExistingVoicetreeDir } from "@/shell/edge/main/project-utils";
import {
    broadcastGraphDeltaToUI
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI";
import { loadSettings } from "@/shell/edge/main/settings/settings_IO";
import { type VTSettings } from "@/pure/settings/types";
import {
    getWatcher,
    setWatcher,
    getProjectRootWatchedDirectory,
    setProjectRootWatchedDirectory,
    getStartupFolderOverride,
    getOnFolderSwitchCleanup,
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
import { createStarterNode } from "./create-starter-node";

// Re-export vault-allowlist functions for api.ts and tests
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

export async function initialLoad(): Promise<void> {
    // If already watching a directory, don't reload
    // This prevents race conditions when startFileWatching() is called before markFrontendReady()
    if (getProjectRootWatchedDirectory() !== null) {
        return;
    }

    // Check for CLI-specified folder first (from "Open Folder in New Instance")
    const startupFolder: string | null = getStartupFolderOverride();
    if (startupFolder !== null) {
        await loadFolder(startupFolder);
        return;
    }

    const lastDirectory: O.Option<string> = await getLastDirectory();
    if (O.isSome(lastDirectory)) {
        await loadFolder(lastDirectory.value);
    }
    // No fallback - ProjectSelectionScreen handles first-run experience
}

/**
 * Resolve or create vault configuration for a project.
 *
 * Handles both cases:
 * 1. Saved config exists: return it (validated)
 * 2. No saved config: find/create voicetree folder, copy onboarding, apply default patterns, save config
 *
 * This unifies the two code paths that were previously in loadFolder.
 */
async function resolveOrCreateConfig(
    watchedFolderPath: string
): Promise<{ writePath: string; readPaths: readonly string[]; allowlist: readonly string[] }> {
    // Try to resolve from saved vaultConfig first
    const savedConfig: { allowlist: readonly string[]; writePath: string; readPaths: readonly string[] } | null =
        await resolveAllowlistForProject(watchedFolderPath);

    if (savedConfig) {
        return savedConfig;
    }

    // No saved config - find or create voicetree subfolder
    const existingVoicetreeDir: string | null = await findExistingVoicetreeDir(watchedFolderPath);
    let subfolderPath: string;

    if (existingVoicetreeDir !== null) {
        // Use existing voicetree directory (don't copy onboarding)
        subfolderPath = existingVoicetreeDir;
    } else {
        // Create new voicetree-{date} subfolder
        const subfolder: string = generateDateSubfolder();
        subfolderPath = path.join(watchedFolderPath, subfolder);
        await fs.mkdir(subfolderPath, { recursive: true });

        // Copy onboarding files into the new subfolder
        const onboardingSourceDir: string = path.join(getOnboardingDirectory(), 'voicetree');
        if (await pathExists(onboardingSourceDir)) {
            await copyMarkdownFiles(onboardingSourceDir, subfolderPath);
        }
    }

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
    const readPaths: readonly string[] = allowlist.filter(p => p !== subfolderPath);
    await saveVaultConfigForDirectory(watchedFolderPath, {
        writePath: subfolderPath,
        readPaths
    });

    return {
        allowlist,
        writePath: subfolderPath,
        readPaths
    };
}

export async function loadFolder(watchedFolderPath: FilePath): Promise<{ success: boolean }> {
    // TODO: Save current graph positions before switching folders (writeAllPositionsSync)
    // IMPORTANT: watchedFolderPath is the folder the human chooses for the project
    // writePath (from vaultConfig) is where new files are created

    const mainWindow: Electron.CrossProcessExports.BrowserWindow | null = getMainWindow();
    if (!mainWindow) {
        console.error('No main window available');
        return { success: false };
    }

    // Update projectRootWatchedDirectory FIRST
    setProjectRootWatchedDirectory(watchedFolderPath);

    // Close old watcher before attempting to load new folder
    const oldWatcher: FSWatcher | null = getWatcher();
    if (oldWatcher) {
        await oldWatcher.close();
        setWatcher(null);
    }

    // Clean up terminals and other resources before switching folders
    const folderCleanup: (() => void) | null = getOnFolderSwitchCleanup();
    if (folderCleanup) {
        folderCleanup();
    }

    // Clear existing graph state in UI-edge before loading new folder
    if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('graph:clear');
    }

    // Resolve or create config (unified path)
    const config: { writePath: string; readPaths: readonly string[]; allowlist: readonly string[] } =
        await resolveOrCreateConfig(watchedFolderPath);

    // Load graph from all paths
    const loadResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk(config.allowlist);

    if (E.isLeft(loadResult)) {
        // File limit exceeded - create new voicetree-{date} workspace
        return createNewWorkspaceOnFileLimitExceeded(
            watchedFolderPath,
            loadResult.left.fileCount,
            mainWindow,
            config.readPaths
        );
    }

    return finishLoading(loadResult.right, config, watchedFolderPath, mainWindow);
}

/**
 * Handle file limit exceeded by creating a new voicetree-{date} workspace.
 * Used by both savedConfig and no-savedConfig paths to avoid duplication.
 */
async function createNewWorkspaceOnFileLimitExceeded(
    watchedFolderPath: FilePath,
    fileCount: number,
    mainWindow: Electron.CrossProcessExports.BrowserWindow,
    existingReadPaths: readonly string[]
): Promise<{ success: boolean }> {
    const subfolder: string = generateDateSubfolder();
    const newSubfolderPath: string = path.join(watchedFolderPath, subfolder);
    await fs.mkdir(newSubfolderPath, { recursive: true });

    // Show info dialog (non-blocking)
    void dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'New Workspace Created',
        message: `Previous workspace has ${fileCount} markdown files (limit: 300).\n\nCreated new workspace:\n${newSubfolderPath}`,
        buttons: ['OK']
    });

    // Build new config with the new subfolder, keeping readPaths for linking
    const newAllowlist: string[] = [newSubfolderPath, ...existingReadPaths];
    const newConfig: { allowlist: readonly string[]; writePath: string; readPaths: readonly string[] } = {
        allowlist: newAllowlist,
        writePath: newSubfolderPath,
        readPaths: existingReadPaths
    };
    await saveVaultConfigForDirectory(watchedFolderPath, {
        writePath: newSubfolderPath,
        readPaths: existingReadPaths
    });

    // Load from the new subfolder (empty initially)
    const retryResult: E.Either<FileLimitExceededError, Graph> = await loadGraphFromDisk([newSubfolderPath]);
    if (E.isLeft(retryResult)) {
        // Should not happen with empty folder, but handle gracefully
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
        directory: getProjectRootWatchedDirectory(),
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
            defaultPath: getProjectRootWatchedDirectory() ?? process.env.HOME ?? '/'
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
    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        await currentWatcher.close();
        setWatcher(null);
        setProjectRootWatchedDirectory(null);
    }
    return { success: true };
}

export function getWatchStatus(): { readonly isWatching: boolean; readonly directory: string | undefined } {
    const status: { isWatching: boolean; directory: string | undefined } = {
        isWatching: isWatching(),
        directory: getProjectRootWatchedDirectory() ?? undefined
    };
    //console.log('Watch status:', status);
    return status;
}

export async function loadPreviousFolder(): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    //console.log('[watchFolder] loadPreviousFolder called');
    await initialLoad();
    const watchedDir: string | null = getProjectRootWatchedDirectory();
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

