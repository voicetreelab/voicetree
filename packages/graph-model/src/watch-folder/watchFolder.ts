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

import type { FilePath } from '../pure/graph';
import { getGraph, setGraph } from "../state/graph-store";
import path from "path";
import * as O from "fp-ts/lib/Option.js";
import { promises as fs } from "fs";
import fsSync from "fs";
import type { FSWatcher } from "chokidar";
import { getCallbacks } from "../types";
import { copyMarkdownFiles, pathExists, createDatedSubfolder, findExistingVoicetreeDir } from "../project/project-utils";
import { loadSettings } from "../settings/settings_IO";
import { type VTSettings } from '../pure/settings/types';
import {
    getWatcher,
    setWatcher,
    getProjectRootWatchedDirectory,
    setProjectRootWatchedDirectory,
    getStartupFolderOverride,
    getOnFolderSwitchCleanup,
} from "../state/watch-folder-store";

// Import from extracted modules
import {
    getLastDirectory,
    saveLastDirectory,
    saveVaultConfigForDirectory,
} from "./voicetree-config-io";
import {
    resolveAllowlistForProject,
    loadAndMergeVaultPath,
    type LoadVaultPathResult,
} from "./vault-allowlist";
import { setupWatcher } from "./file-watcher-setup";
import type { WatcherOptions } from "./file-watcher-setup";
import { createWatcherOptions, DEFAULT_WATCHER_OPTIONS } from "./watcher-options.shared";
import { createEmptyGraph } from '../pure/graph/createGraph';
import { broadcastVaultState } from "./broadcast-vault-state";
import { loadPositions, savePositionsSync } from "../graph/positions-store";

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
    createDatedVoiceTreeFolder,
    createSubfolder,
} from "./vault-allowlist";

// Re-export folder-scanner functions for api.ts
export { getAvailableFoldersForSelector } from "./folder-scanner";

export interface WatchFolderLoadOptions {
    mountWatcher?: boolean;
}

async function resolveWatcherOptions(): Promise<WatcherOptions> {
    const maybeProcess: { env?: Record<string, string | undefined> } | undefined =
        (globalThis as typeof globalThis & {
            process?: { env?: Record<string, string | undefined> }
        }).process;

    if (!maybeProcess?.env) {
        return DEFAULT_WATCHER_OPTIONS;
    }

    return createWatcherOptions(
        maybeProcess.env.HEADLESS_TEST === '1' || maybeProcess.env.NODE_ENV === 'test'
    );
}

export async function initialLoad(options: WatchFolderLoadOptions = {}): Promise<void> {
    // If already watching a directory, don't reload
    // This prevents race conditions when startFileWatching() is called before markFrontendReady()
    if (getProjectRootWatchedDirectory() !== null) {
        return;
    }

    // Check for CLI-specified folder first (from "Open Folder in New Instance")
    const startupFolder: string | null = getStartupFolderOverride();
    if (startupFolder !== null) {
        await loadFolder(startupFolder, options);
        return;
    }

    const lastDirectory: O.Option<string> = await getLastDirectory();
    // Re-check after yield - startFileWatching may have set projectRootWatchedDirectory during the await
    if (getProjectRootWatchedDirectory() !== null) return;
    if (O.isSome(lastDirectory)) {
        await loadFolder(lastDirectory.value, options);
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
        subfolderPath = await createDatedSubfolder(watchedFolderPath);

        // Copy onboarding files into the new subfolder
        const onboardingDir: string | undefined = getCallbacks().getOnboardingDirectory?.();
        if (onboardingDir) {
            const onboardingSourceDir: string = path.join(onboardingDir, 'voicetree');
            if (await pathExists(onboardingSourceDir)) {
                await copyMarkdownFiles(onboardingSourceDir, subfolderPath);
            }
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

export async function loadFolder(
    watchedFolderPath: FilePath,
    options: WatchFolderLoadOptions = {},
): Promise<{ success: boolean }> {
    // Save current graph positions before switching folders
    const previousRoot: FilePath | null = getProjectRootWatchedDirectory();
    if (previousRoot) {
        savePositionsSync(getGraph(), previousRoot);
    }
    // IMPORTANT: watchedFolderPath is the folder the human chooses for the project
    // writePath (from vaultConfig) is where new files are created

    // Update projectRootWatchedDirectory FIRST
    setProjectRootWatchedDirectory(watchedFolderPath);

    // Write .mcp.json with current MCP port so external agents can discover the server
    void getCallbacks().enableMcpIntegration?.().catch(() => { /* MCP server may not be ready yet */ });

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
    getCallbacks().onGraphCleared?.();

    // Resolve or create config (unified path)
    const config: { writePath: string; readPaths: readonly string[]; allowlist: readonly string[] } =
        await resolveOrCreateConfig(watchedFolderPath);

    // Ensure .voicetree/ has default prompts and hook scripts (copy-on-first-open)
    await getCallbacks().ensureProjectSetup?.(watchedFolderPath).catch((error: unknown) => {
        console.warn('[loadFolder] Failed to set up .voicetree/ defaults:', error);
    });

    await getCallbacks().ensureDaemonForVault?.(watchedFolderPath)

    // Clear graph in memory before loading paths
    setGraph(createEmptyGraph());

    // Load persisted positions BEFORE loading vault paths so they can be
    // merged into the graph before broadcasting to UI
    const positions: ReadonlyMap<string, import('../pure/graph').Position> = await loadPositions(watchedFolderPath);

    // Load write path first (handles all side effects internally)
    const writeResult: LoadVaultPathResult = await loadAndMergeVaultPath(config.writePath, { isWritePath: true }, positions);
    if (!writeResult.success) {
        // Check for file limit exceeded error
        if (writeResult.error?.includes('File limit exceeded')) {
            const match: RegExpMatchArray | null = writeResult.error.match(/(\d+) files/);
            const fileCount: number = match ? parseInt(match[1], 10) : 0;
            return createNewWorkspaceOnFileLimitExceeded(
                watchedFolderPath,
                fileCount,
                config.readPaths,
                options,
            );
        }
        return { success: false };
    }

    // Load read paths (handles all side effects internally)
    for (const readPath of config.readPaths) {
        const readResult: LoadVaultPathResult = await loadAndMergeVaultPath(readPath, { isWritePath: false }, positions);
        if (!readResult.success) {
            // Check for file limit exceeded error
            if (readResult.error?.includes('File limit exceeded')) {
                const match: RegExpMatchArray | null = readResult.error.match(/(\d+) files/);
                const fileCount: number = match ? parseInt(match[1], 10) : 0;
                return createNewWorkspaceOnFileLimitExceeded(
                    watchedFolderPath,
                    fileCount,
                    config.readPaths,
                    options,
                );
            }
            // Log but continue with remaining paths for non-fatal errors
            console.warn(`[loadFolder] Failed to load read path ${readPath}: ${readResult.error}`);
            continue;
        }
    }

    if (options.mountWatcher !== false) {
        // Resolve watcher options lazily so renderer imports never touch process.env.
        const watcherOptions: WatcherOptions = await resolveWatcherOptions();

        // Setup file watcher - watch all paths in allowlist
        await setupWatcher(config.allowlist, watchedFolderPath, watcherOptions);
    }

    // Save as last directory for auto-start on next launch
    await saveLastDirectory(watchedFolderPath);

    // Notify UI that watching has started
    getCallbacks().onWatchingStarted?.({
        directory: getProjectRootWatchedDirectory() ?? watchedFolderPath,
        writePath: config.writePath,
        timestamp: new Date().toISOString()
    });

    // Push initial vault state to renderer (readPaths, writePath, starredFolders)
    void broadcastVaultState();

    return { success: true };
}

/**
 * Handle file limit exceeded by creating a new voicetree-{date} workspace.
 * Used by both savedConfig and no-savedConfig paths to avoid duplication.
 */
async function createNewWorkspaceOnFileLimitExceeded(
    watchedFolderPath: FilePath,
    fileCount: number,
    existingReadPaths: readonly string[],
    options: WatchFolderLoadOptions = {},
): Promise<{ success: boolean }> {
    const newSubfolderPath: string = await createDatedSubfolder(watchedFolderPath);

    // Show info dialog (non-blocking)
    void getCallbacks().showInfoDialog?.(
        'New Workspace Created',
        `Previous workspace has ${fileCount} markdown files (limit: 600).\n\nCreated new workspace:\n${newSubfolderPath}`
    );

    // Save new config with the new subfolder, keeping readPaths for linking
    await saveVaultConfigForDirectory(watchedFolderPath, {
        writePath: newSubfolderPath,
        readPaths: existingReadPaths
    });

    // Clear graph before loading new workspace
    setGraph(createEmptyGraph());

    // Load from the new subfolder (handles all side effects internally, including starter node)
    const writeResult: LoadVaultPathResult = await loadAndMergeVaultPath(newSubfolderPath, { isWritePath: true });
    if (!writeResult.success) {
        // Should not happen with empty folder, but handle gracefully
        return { success: false };
    }

    if (options.mountWatcher !== false) {
        const watcherOptions: WatcherOptions = await resolveWatcherOptions();

        // Setup file watcher for the new workspace
        const newAllowlist: readonly string[] = [newSubfolderPath, ...existingReadPaths];
        await setupWatcher(newAllowlist, watchedFolderPath, watcherOptions);
    }

    // Save as last directory for auto-start on next launch
    await saveLastDirectory(watchedFolderPath);

    // Notify UI that watching has started
    getCallbacks().onWatchingStarted?.({
        directory: getProjectRootWatchedDirectory() ?? watchedFolderPath,
        writePath: newSubfolderPath,
        timestamp: new Date().toISOString()
    });

    // Push updated vault state to renderer so VaultPathSelector re-renders
    void broadcastVaultState();

    return { success: true };
}

export function isWatching(): boolean {
    return getWatcher() !== null;
}

// API functions for file watching operations

export async function startFileWatching(
    directoryPath?: string,
    options: WatchFolderLoadOptions = {},
): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    // Get selected directory (either from param or via dialog)
    const getDirectory: () => Promise<string | null> = async (): Promise<string | null> => {
        if (directoryPath) {
            return directoryPath;
        }

        const selected: string | undefined = await getCallbacks().openFolderDialog?.();
        return selected ?? null;
    };

    const selectedDirectory: string | null = await getDirectory();

    if (!selectedDirectory) {
        return { success: false, error: 'No new directory selected' };
    }

    // FAIL FAST: Validate directory exists before proceeding
    if (!fsSync.existsSync(selectedDirectory)) {
        const error: string = `Directory does not exist: ${selectedDirectory}`;
        console.error('[watchFolder] startFileWatching failed:', error);
        return { success: false, error };
    }

    if (!fsSync.statSync(selectedDirectory).isDirectory()) {
        const error: string = `Path is not a directory: ${selectedDirectory}`;
        console.error('[watchFolder] startFileWatching failed:', error);
        return { success: false, error };
    }

    await loadFolder(selectedDirectory, options);
    return { success: true, directory: selectedDirectory };
}

export async function stopFileWatching(): Promise<{ readonly success: boolean; readonly error?: string }> {
    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        await currentWatcher.close();
        setWatcher(null);
    }
    setProjectRootWatchedDirectory(null);
    return { success: true };
}

export function getWatchStatus(): { readonly isWatching: boolean; readonly directory: string | undefined } {
    const status: { isWatching: boolean; directory: string | undefined } = {
        isWatching: isWatching(),
        directory: getProjectRootWatchedDirectory() ?? undefined
    };
    return status;
}

export async function loadPreviousFolder(
    options: WatchFolderLoadOptions = {},
): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    await initialLoad(options);
    const watchedDir: string | null = getProjectRootWatchedDirectory();
    if (watchedDir) {
        return { success: true, directory: watchedDir };
    } else {
        return { success: false, error: 'No previous folder found' };
    }
}

/**
 * Called by renderer when frontend is ready to receive graph data.
 * Triggers initial folder load - main process decides what folder to load.
 */
export async function markFrontendReady(options: WatchFolderLoadOptions = {}): Promise<void> {
    await initialLoad(options);
}
