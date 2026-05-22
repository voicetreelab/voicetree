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

import type { FilePath, Position } from '@vt/graph-model/graph';
import { getGraph, setGraph } from "../../state/graph-store";
import path from "path";
import * as O from "fp-ts/lib/Option.js";
import { promises as fs } from "fs";
import fsSync from "fs";
import type { FSWatcher } from "chokidar";
import { getCallbacks } from "@vt/graph-model";
import { copyMarkdownFiles, pathExists, createDatedSubfolder, findExistingVoicetreeDir } from "@vt/app-config/project";
import { loadSettings } from "@vt/app-config/settings";
import { type VTSettings } from '@vt/graph-model/settings';
import {
    getWatcher,
    setWatcher,
    getProjectRootWatchedDirectory,
    setProjectRootWatchedDirectory,
    getStartupFolderOverride,
    getOnFolderSwitchCleanup,
} from "../../state/watch-folder-store";
import {
    getLastDirectory,
    saveLastDirectory,
    saveVaultConfigForDirectory,
} from "@vt/app-config/vault-config";
import {
    resolveAllowlistForProject,
    loadAndMergeVaultPath,
    type VaultLoadOutcome,
    type FileLimitDetails,
} from "../../state/vaultAllowlist";
import { setActiveViewFolderState } from "../../data/watch-folder/folder-visibility-active-view";
import { setupWatcher } from "../../data/watch-folder/watching/file-watcher-setup";
import { setupStateChangeSubscriptions } from "../../data/views/watcherRebuild";
import type { WatcherOptions } from "../../data/watch-folder/watching/file-watcher-setup";
import { createWatcherOptions, DEFAULT_WATCHER_OPTIONS } from "../../data/watch-folder/watching/watcher-options.shared";
import { createEmptyGraph } from '@vt/graph-model/graph';
import { broadcastVaultState } from "../../data/watch-folder/broadcast/broadcast-vault-state";
import { loadPositions, savePositionsSync } from "@vt/app-config/positions";
import {
    decideVaultConfig,
    type WatchFolderConfig,
} from "../core/vault-config/decideVaultConfig";
import {
    buildPatternAllowlist as buildPatternAllowlistPure,
    type PatternProbe,
} from "../core/vault-config/buildPatternAllowlist";

export interface WatchFolderLoadOptions {
    broadcastVaultState?: boolean;
    mountWatcher?: boolean;
    includeActiveViewExpandedPaths?: boolean;
    persistDefaultExpandedPaths?: boolean;
    effects?: WatchFolderEffects;
}

export interface WatchFolderEffects {
    readonly warn: (message?: unknown, ...optionalParams: unknown[]) => void;
    readonly nowIso: () => string;
}

const defaultWatchFolderEffects: WatchFolderEffects = {
    warn(message?: unknown, ...optionalParams: unknown[]): void {
        console.warn(message, ...optionalParams);
    },
    nowIso(): string {
        return new Date().toISOString();
    },
};

function getWatchFolderEffects(options: WatchFolderLoadOptions): WatchFolderEffects {
    return options.effects ?? defaultWatchFolderEffects;
}

function buildWatchingStartedPayload(
    directory: string,
    writePath: string,
    timestamp: string,
): { readonly directory: string; readonly writePath: string; readonly timestamp: string } {
    return { directory, writePath, timestamp };
}

function getWatchingStartedDirectory(watchedFolderPath: FilePath): string {
    return getProjectRootWatchedDirectory() ?? watchedFolderPath;
}

function validateDirectoryForWatching(selectedDirectory: string): string | null {
    if (!fsSync.existsSync(selectedDirectory)) {
        return `Directory does not exist: ${selectedDirectory}`;
    }

    if (!fsSync.statSync(selectedDirectory).isDirectory()) {
        return `Path is not a directory: ${selectedDirectory}`;
    }

    return null;
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
    watchedFolderPath: string,
    options: WatchFolderLoadOptions = {},
): Promise<WatchFolderConfig> {
    const savedConfig: WatchFolderConfig | null =
        await resolveAllowlistForProject(watchedFolderPath, {
            includeActiveViewExpandedPaths: options.includeActiveViewExpandedPaths,
        });
    if (savedConfig) {
        return decideVaultConfig(savedConfig, '', []).config;
    }

    const subfolderPath: string = await findOrCreateSubfolder(watchedFolderPath);
    const allowlist: readonly string[] = await resolveDefaultPatternAllowlist(
        watchedFolderPath,
        subfolderPath,
        options.persistDefaultExpandedPaths !== false,
    );

    const plan = decideVaultConfig(null, subfolderPath, allowlist);
    if (plan.shouldPersist) {
        await saveVaultConfigForDirectory(watchedFolderPath, { writePath: plan.config.writePath });
    }
    return plan.config;
}

async function findOrCreateSubfolder(watchedFolderPath: string): Promise<string> {
    const existingVoicetreeDir: string | null = await findExistingVoicetreeDir(watchedFolderPath);

    if (existingVoicetreeDir !== null) {
        // Use existing voicetree directory (don't copy onboarding)
        return existingVoicetreeDir;
    }

    // Create new voicetree-{date} subfolder
    const subfolderPath: string = await createDatedSubfolder(watchedFolderPath);

    // Copy onboarding files into the new subfolder
    const onboardingDir: string | undefined = getCallbacks().getOnboardingDirectory?.();
    if (onboardingDir) {
        const onboardingSourceDir: string = path.join(onboardingDir, 'voicetree');
        if (await pathExists(onboardingSourceDir)) {
            await copyMarkdownFiles(onboardingSourceDir, subfolderPath);
        }
    }

    return subfolderPath;
}

async function resolveDefaultPatternAllowlist(
    watchedFolderPath: string,
    subfolderPath: string,
    persistDefaultExpandedPaths: boolean,
): Promise<readonly string[]> {
    const settings: VTSettings = await loadSettings();
    const patterns: readonly string[] = settings.defaultAllowlistPatterns ?? [];

    const probes: readonly PatternProbe[] = await Promise.all(
        patterns.map(async (pattern: string): Promise<PatternProbe> => {
            const patternPath: string = path.join(watchedFolderPath, pattern);
            try {
                await fs.access(patternPath);
                return { patternPath, exists: true };
            } catch {
                return { patternPath, exists: false };
            }
        }),
    );

    const plan = buildPatternAllowlistPure(subfolderPath, probes, persistDefaultExpandedPaths);
    for (const expandedPath of plan.pathsToMarkExpanded) {
        await setActiveViewFolderState(watchedFolderPath, expandedPath, 'expanded');
    }
    return plan.allowlist;
}

function getExpandedPaths(config: WatchFolderConfig): readonly string[] {
    return config.allowlist.filter((folderPath: string) => folderPath !== config.writePath);
}

async function handleVaultLoadOutcome(
    outcome: VaultLoadOutcome,
    watchedFolderPath: FilePath,
    config: WatchFolderConfig,
    options: WatchFolderLoadOptions,
): Promise<{ success: boolean } | null> {
    switch (outcome.kind) {
        case 'ok':
            return null;
        case 'fileLimit':
            return createNewWorkspaceOnFileLimitExceeded(
                watchedFolderPath,
                outcome.details,
                getExpandedPaths(config),
                options,
            );
        case 'failed':
            return { success: false };
    }
}

async function loadExpandedPaths(
    config: WatchFolderConfig,
    positions: ReadonlyMap<string, Position>,
    watchedFolderPath: FilePath,
    options: WatchFolderLoadOptions,
    effects: WatchFolderEffects,
): Promise<{ success: boolean } | null> {
    for (const expandedPath of getExpandedPaths(config)) {
        const outcome: VaultLoadOutcome = await loadAndMergeVaultPath(
            expandedPath,
            { isWritePath: false },
            positions,
        );

        switch (outcome.kind) {
            case 'ok':
                continue;
            case 'fileLimit':
                return handleVaultLoadOutcome(outcome, watchedFolderPath, config, options);
            case 'failed':
                effects.warn(`[loadFolder] Failed to load expanded path ${expandedPath}: ${outcome.reason}`);
        }
    }

    return null;
}

export async function loadFolder(
    watchedFolderPath: FilePath,
    options: WatchFolderLoadOptions = {},
): Promise<{ success: boolean }> {
    const effects: WatchFolderEffects = getWatchFolderEffects(options);

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
    const config: WatchFolderConfig = await resolveOrCreateConfig(watchedFolderPath, options);

    // Ensure .voicetree/ has default prompts and hook scripts (copy-on-first-open)
    await getCallbacks().ensureProjectSetup?.(watchedFolderPath).catch((error: unknown) => {
        effects.warn('[loadFolder] Failed to set up .voicetree/ defaults:', error);
    });

    await getCallbacks().ensureDaemonForVault?.(watchedFolderPath)

    // Clear graph in memory before loading paths
    setGraph(createEmptyGraph());

    // Load persisted positions BEFORE loading vault paths so they can be
    // merged into the graph before broadcasting to UI
    const positions: ReadonlyMap<string, Position> = await loadPositions(watchedFolderPath);

    // Load write path first (handles all side effects internally)
    const writeOutcome: VaultLoadOutcome = await loadAndMergeVaultPath(config.writePath, { isWritePath: true }, positions);
    const writeRecoveryResult: { success: boolean } | null = await handleVaultLoadOutcome(
        writeOutcome,
        watchedFolderPath,
        config,
        options,
    );
    if (writeRecoveryResult) return writeRecoveryResult;

    // Load active-view expanded paths (handles all side effects internally)
    const expandedRecoveryResult: { success: boolean } | null = await loadExpandedPaths(
        config,
        positions,
        watchedFolderPath,
        options,
        effects,
    );
    if (expandedRecoveryResult) return expandedRecoveryResult;

    if (options.mountWatcher !== false) {
        // Resolve watcher options lazily so renderer imports never touch process.env.
        const watcherOptions: WatcherOptions = await resolveWatcherOptions();

        // Setup file watcher - watch all paths in allowlist
        await setupWatcher(config.allowlist, watchedFolderPath, watcherOptions);

        // Subscribe to folder-visibility and view-switch events to rebuild watcher on state change
        await setupStateChangeSubscriptions(watchedFolderPath);
    }

    // Save as last directory for auto-start on next launch
    await saveLastDirectory(watchedFolderPath);

    // Notify UI that watching has started
    getCallbacks().onWatchingStarted?.(buildWatchingStartedPayload(
        getWatchingStartedDirectory(watchedFolderPath),
        config.writePath,
        effects.nowIso(),
    ));

    if (options.broadcastVaultState !== false) {
        // Push initial vault state to renderer before resolving so callers/tests
        // do not tear down app support while the settings-backed broadcast runs.
        await broadcastVaultState();
    }

    return { success: true };
}

/**
 * Handle file limit exceeded by creating a new voicetree-{date} workspace.
 * Used by both savedConfig and no-savedConfig paths to avoid duplication.
 */
async function createNewWorkspaceOnFileLimitExceeded(
    watchedFolderPath: FilePath,
    fileLimitDetails: FileLimitDetails,
    existingExpandedPaths: readonly string[],
    options: WatchFolderLoadOptions = {},
): Promise<{ success: boolean }> {
    const effects: WatchFolderEffects = getWatchFolderEffects(options);
    const newSubfolderPath: string = await createDatedSubfolder(watchedFolderPath);

    // Show info dialog (non-blocking)
    void getCallbacks().showInfoDialog?.(
        'New Workspace Created',
        `Previous workspace has ${fileLimitDetails.fileCount} markdown files (limit: ${fileLimitDetails.maxFiles}).\n\nCreated new workspace:\n${newSubfolderPath}`
    );

    // Save new config with the new subfolder, keeping expanded paths for linking
    await saveVaultConfigForDirectory(watchedFolderPath, {
        writePath: newSubfolderPath,
    });

    // Clear graph before loading new workspace
    setGraph(createEmptyGraph());

    // Load from the new subfolder (handles all side effects internally, including starter node)
    const writeOutcome: VaultLoadOutcome = await loadAndMergeVaultPath(newSubfolderPath, { isWritePath: true });
    if (writeOutcome.kind !== 'ok') {
        // Should not happen with empty folder, but handle gracefully
        return { success: false };
    }

    if (options.mountWatcher !== false) {
        const watcherOptions: WatcherOptions = await resolveWatcherOptions();

        // Setup file watcher for the new workspace
        const newAllowlist: readonly string[] = [newSubfolderPath, ...existingExpandedPaths];
        await setupWatcher(newAllowlist, watchedFolderPath, watcherOptions);
    }

    // Save as last directory for auto-start on next launch
    await saveLastDirectory(watchedFolderPath);

    // Notify UI that watching has started
    getCallbacks().onWatchingStarted?.(buildWatchingStartedPayload(
        getProjectRootWatchedDirectory() ?? watchedFolderPath,
        newSubfolderPath,
        effects.nowIso(),
    ));

    if (options.broadcastVaultState !== false) {
        // Push updated vault state to renderer so VaultPathSelector re-renders.
        await broadcastVaultState();
    }

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

    const error: string | null = validateDirectoryForWatching(selectedDirectory);
    if (error !== null) {
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
