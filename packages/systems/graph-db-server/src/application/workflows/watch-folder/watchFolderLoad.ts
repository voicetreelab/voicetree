/**
 * Watch folder orchestration.
 *
 * Coordinates folder loading and file watching: initial load, folder switching,
 * starting/stopping watchers. Effect deps are threaded via WatchFolderEnv so
 * the call graph's I/O surface is visible at every function boundary.
 */

import type { FilePath, Position } from '@vt/graph-model/graph';
import { getGraph, setGraph } from "@vt/graph-db-server/state/graph-store";
import path from "path";
import * as O from "fp-ts/lib/Option.js";
import type { FSWatcher } from "chokidar";
import type { VTSettings } from '@vt/graph-model/settings';
import {
    getWatcher,
    setWatcher,
    getProjectRoot,
    setProjectRoot,
} from "@vt/graph-db-server/state/watch-folder-store";
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
} from "@vt/graph-db-server/state/vaultAllowlist";
import { setActiveViewFolderState } from "@vt/graph-db-server/watch-folder/folder-visibility-active-view";
import { setupWatcher } from "@vt/graph-db-server/watch-folder/watching/file-watcher-setup";
import { setupStateChangeSubscriptions } from "@vt/graph-db-server/views/watcherRebuild";
import type { WatcherOptions } from "@vt/graph-db-server/watch-folder/watching/file-watcher-setup";
import { createWatcherOptions, DEFAULT_WATCHER_OPTIONS } from "@vt/graph-db-server/watch-folder/watching/watcher-options.shared";
import { createEmptyGraph } from '@vt/graph-model/graph';
import { broadcastVaultState } from "@vt/graph-db-server/watch-folder/broadcast/broadcast-vault-state";
import { positionsIO } from "@vt/app-config/positions-io";
import {
    decideVaultConfig,
    type WatchFolderConfig,
} from "@vt/graph-db-server/application/core/vault-config/decideVaultConfig";
import {
    buildPatternAllowlist as buildPatternAllowlistPure,
    type PatternProbe,
} from "@vt/graph-db-server/application/core/vault-config/buildPatternAllowlist";
import {
    defaultWatchFolderEnv,
    type WatchFolderEnv,
} from "./watchFolderEnv";

export interface WatchFolderLoadOptions {
    broadcastVaultState?: boolean;
    mountWatcher?: boolean;
    includeActiveViewExpandedPaths?: boolean;
    persistDefaultExpandedPaths?: boolean;
}

function buildWatchingStartedPayload(
    directory: string,
    writeFolder: string,
    timestamp: string,
): { readonly directory: string; readonly writeFolder: string; readonly timestamp: string } {
    return { directory, writeFolder, timestamp };
}

function getWatchingStartedDirectory(watchedFolderPath: FilePath): string {
    return getProjectRoot() ?? watchedFolderPath;
}

export function validateDirectoryForWatching(env: WatchFolderEnv, selectedDirectory: string): string | null {
    if (!env.fs.existsSync(selectedDirectory)) {
        return `Directory does not exist: ${selectedDirectory}`;
    }
    if (!env.fs.statSyncIsDirectory(selectedDirectory)) {
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
        maybeProcess.env.HEADLESS_TEST === '1' ||
        maybeProcess.env.NODE_ENV === 'test' ||
        maybeProcess.env.NODE_ENV === 'development'
    );
}

/**
 * @deprecated Use {@link openProject} (no argument) instead. Will be
 * removed in `watch-folder-verb-consolidation` Phase 5.
 */
export async function initialLoad(options: WatchFolderLoadOptions = {}): Promise<void> {
    if (getProjectRoot() !== null) {
        return;
    }

    const lastDirectory: O.Option<string> = await getLastDirectory();
    if (getProjectRoot() !== null) return;
    if (O.isSome(lastDirectory)) {
        await loadFolder(lastDirectory.value, options);
    }
}

async function resolveOrCreateConfig(
    env: WatchFolderEnv,
    watchedFolderPath: string,
    options: WatchFolderLoadOptions,
): Promise<WatchFolderConfig> {
    const savedConfig: WatchFolderConfig | null =
        await resolveAllowlistForProject(watchedFolderPath, {
            includeActiveViewExpandedPaths: options.includeActiveViewExpandedPaths,
        });
    if (savedConfig) {
        return decideVaultConfig(savedConfig, '', []).config;
    }

    const subfolderPath: string = await findOrCreateSubfolder(env, watchedFolderPath);
    const allowlist: readonly string[] = await resolveDefaultPatternAllowlist(
        env,
        watchedFolderPath,
        subfolderPath,
        options.persistDefaultExpandedPaths !== false,
    );

    const plan = decideVaultConfig(null, subfolderPath, allowlist);
    if (plan.shouldPersist) {
        await saveVaultConfigForDirectory(watchedFolderPath, { writeFolder: plan.config.writeFolder });
    }
    return plan.config;
}

async function findOrCreateSubfolder(
    env: WatchFolderEnv,
    watchedFolderPath: string,
): Promise<string> {
    const existingVoicetreeDir: string | null = await env.project.findExistingVoicetreeDir(watchedFolderPath);
    if (existingVoicetreeDir !== null) {
        return existingVoicetreeDir;
    }

    const subfolderPath: string = await env.project.createDatedSubfolder(watchedFolderPath);

    const onboardingDir: string | undefined = env.callbacks().getOnboardingDirectory?.();
    if (onboardingDir) {
        const onboardingSourceDir: string = path.join(onboardingDir, 'voicetree');
        if (await env.fs.pathExists(onboardingSourceDir)) {
            await env.project.copyMarkdownFiles(onboardingSourceDir, subfolderPath);
        }
    }

    return subfolderPath;
}

async function resolveDefaultPatternAllowlist(
    env: WatchFolderEnv,
    watchedFolderPath: string,
    subfolderPath: string,
    persistDefaultExpandedPaths: boolean,
): Promise<readonly string[]> {
    const settings: VTSettings = await env.settings();
    const patterns: readonly string[] = settings.defaultAllowlistPatterns ?? [];

    const probes: readonly PatternProbe[] = await Promise.all(
        patterns.map(async (pattern: string): Promise<PatternProbe> => {
            const patternPath: string = path.join(watchedFolderPath, pattern);
            try {
                await env.fs.access(patternPath);
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
    return config.allowlist.filter((folderPath: string) => folderPath !== config.writeFolder);
}

async function handleVaultLoadOutcome(
    env: WatchFolderEnv,
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
                env,
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
    env: WatchFolderEnv,
    config: WatchFolderConfig,
    positions: ReadonlyMap<string, Position>,
    watchedFolderPath: FilePath,
    options: WatchFolderLoadOptions,
): Promise<{ success: boolean } | null> {
    for (const expandedPath of getExpandedPaths(config)) {
        const outcome: VaultLoadOutcome = await loadAndMergeVaultPath(
            expandedPath,
            { isWriteFolder: false },
            positions,
        );

        switch (outcome.kind) {
            case 'ok':
                continue;
            case 'fileLimit':
                return handleVaultLoadOutcome(env, outcome, watchedFolderPath, config, options);
            case 'failed':
                console.warn(`[loadFolder] Failed to load expanded path ${expandedPath}: ${outcome.reason}`);
        }
    }

    return null;
}

async function prepareForFolderSwitch(
    env: WatchFolderEnv,
    watchedFolderPath: FilePath,
): Promise<void> {
    const previousRoot: FilePath | null = getProjectRoot();
    if (previousRoot) {
        positionsIO.save(getGraph(), previousRoot);
    }

    setProjectRoot(watchedFolderPath);

    const oldWatcher: FSWatcher | null = getWatcher();
    if (oldWatcher) {
        await oldWatcher.close();
        setWatcher(null);
    }

    env.callbacks().onGraphCleared?.();
}

async function resolveConfigAndPositions(
    env: WatchFolderEnv,
    watchedFolderPath: FilePath,
    options: WatchFolderLoadOptions,
): Promise<{ readonly config: WatchFolderConfig; readonly positions: ReadonlyMap<string, Position> }> {
    const config: WatchFolderConfig = await resolveOrCreateConfig(env, watchedFolderPath, options);

    await env.callbacks().ensureProjectSetup?.(watchedFolderPath).catch((error: unknown) => {
        console.warn('[loadFolder] Failed to set up .voicetree/ defaults:', error);
    });

    await env.callbacks().ensureDaemonForVault?.(watchedFolderPath);

    setGraph(createEmptyGraph());

    const positions: ReadonlyMap<string, Position> = await positionsIO.load(watchedFolderPath);
    return { config, positions };
}

async function loadAllVaultPaths(
    env: WatchFolderEnv,
    watchedFolderPath: FilePath,
    config: WatchFolderConfig,
    positions: ReadonlyMap<string, Position>,
    options: WatchFolderLoadOptions,
): Promise<{ success: boolean } | null> {
    const writeOutcome: VaultLoadOutcome = await loadAndMergeVaultPath(
        config.writeFolder,
        { isWriteFolder: true },
        positions,
    );
    const writeRecovery = await handleVaultLoadOutcome(env, writeOutcome, watchedFolderPath, config, options);
    if (writeRecovery) return writeRecovery;

    return loadExpandedPaths(env, config, positions, watchedFolderPath, options);
}

async function mountWatcherAndFinalize(
    env: WatchFolderEnv,
    watchedFolderPath: FilePath,
    config: WatchFolderConfig,
    options: WatchFolderLoadOptions,
): Promise<void> {
    if (options.mountWatcher !== false) {
        const watcherOptions: WatcherOptions = await resolveWatcherOptions();
        await setupWatcher(config.allowlist, watchedFolderPath, watcherOptions);
        await setupStateChangeSubscriptions(watchedFolderPath);
    }

    await saveLastDirectory(watchedFolderPath);

    env.callbacks().onWatchingStarted?.(buildWatchingStartedPayload(
        getWatchingStartedDirectory(watchedFolderPath),
        config.writeFolder,
        env.clock.nowIso(),
    ));

    if (options.broadcastVaultState !== false) {
        await broadcastVaultState();
    }
}

/**
 * @deprecated Use {@link openProject} instead. Will be removed in
 * `watch-folder-verb-consolidation` Phase 5.
 */
export async function loadFolder(
    watchedFolderPath: FilePath,
    options: WatchFolderLoadOptions = {},
): Promise<{ success: boolean }> {
    const env: WatchFolderEnv = defaultWatchFolderEnv;

    await prepareForFolderSwitch(env, watchedFolderPath);
    const { config, positions } = await resolveConfigAndPositions(env, watchedFolderPath, options);
    const recovery = await loadAllVaultPaths(env, watchedFolderPath, config, positions, options);
    if (recovery) return recovery;
    await mountWatcherAndFinalize(env, watchedFolderPath, config, options);

    return { success: true };
}

async function createNewWorkspaceOnFileLimitExceeded(
    env: WatchFolderEnv,
    watchedFolderPath: FilePath,
    fileLimitDetails: FileLimitDetails,
    existingExpandedPaths: readonly string[],
    options: WatchFolderLoadOptions,
): Promise<{ success: boolean }> {
    const newSubfolderPath: string = await env.project.createDatedSubfolder(watchedFolderPath);

    void env.callbacks().showInfoDialog?.(
        'New Workspace Created',
        `Previous workspace has ${fileLimitDetails.fileCount} markdown files (limit: ${fileLimitDetails.maxFiles}).\n\nCreated new workspace:\n${newSubfolderPath}`
    );

    await saveVaultConfigForDirectory(watchedFolderPath, {
        writeFolder: newSubfolderPath,
    });

    setGraph(createEmptyGraph());

    const writeOutcome: VaultLoadOutcome = await loadAndMergeVaultPath(newSubfolderPath, { isWriteFolder: true });
    if (writeOutcome.kind !== 'ok') {
        return { success: false };
    }

    if (options.mountWatcher !== false) {
        const watcherOptions: WatcherOptions = await resolveWatcherOptions();
        const newAllowlist: readonly string[] = [newSubfolderPath, ...existingExpandedPaths];
        await setupWatcher(newAllowlist, watchedFolderPath, watcherOptions);
    }

    await saveLastDirectory(watchedFolderPath);

    env.callbacks().onWatchingStarted?.(buildWatchingStartedPayload(
        getProjectRoot() ?? watchedFolderPath,
        newSubfolderPath,
        env.clock.nowIso(),
    ));

    if (options.broadcastVaultState !== false) {
        await broadcastVaultState();
    }

    return { success: true };
}

/**
 * @deprecated Use {@link getProjectStatus}().open instead. Will be removed
 * in `watch-folder-verb-consolidation` Phase 5.
 */
export function isWatching(): boolean {
    return getWatcher() !== null;
}

/**
 * @deprecated Use {@link openProject} instead; the dialog fallback now
 * lives in the openProject wrapper. Will be removed in
 * `watch-folder-verb-consolidation` Phase 5.
 */
export async function startFileWatching(
    directoryPath?: string,
    options: WatchFolderLoadOptions = {},
): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    const env: WatchFolderEnv = defaultWatchFolderEnv;

    const selectedDirectory: string | null = directoryPath
        ?? (await env.callbacks().openFolderDialog?.() ?? null);

    if (!selectedDirectory) {
        return { success: false, error: 'No new directory selected' };
    }

    const error: string | null = validateDirectoryForWatching(env, selectedDirectory);
    if (error !== null) {
        return { success: false, error };
    }

    await loadFolder(selectedDirectory, options);
    return { success: true, directory: selectedDirectory };
}

/**
 * @deprecated Use {@link closeProject} instead. Will be removed in
 * `watch-folder-verb-consolidation` Phase 5.
 */
export async function stopFileWatching(): Promise<{ readonly success: boolean; readonly error?: string }> {
    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        await currentWatcher.close();
        setWatcher(null);
    }
    setProjectRoot(null);
    return { success: true };
}

/**
 * @deprecated Use {@link getProjectStatus} instead. Will be removed in
 * `watch-folder-verb-consolidation` Phase 5.
 */
export function getWatchStatus(): { readonly isWatching: boolean; readonly directory: string | undefined } {
    return {
        isWatching: isWatching(),
        directory: getProjectRoot() ?? undefined,
    };
}

/**
 * @deprecated Use {@link openProject} (no argument) instead. Will be
 * removed in `watch-folder-verb-consolidation` Phase 5.
 */
export async function loadPreviousFolder(
    options: WatchFolderLoadOptions = {},
): Promise<{ readonly success: boolean; readonly directory?: string; readonly error?: string }> {
    await initialLoad(options);
    const watchedDir: string | null = getProjectRoot();
    if (watchedDir) {
        return { success: true, directory: watchedDir };
    }
    return { success: false, error: 'No previous folder found' };
}

/**
 * @deprecated Use {@link openProject} (no argument) instead. Will be
 * removed in `watch-folder-verb-consolidation` Phase 5.
 */
export async function markFrontendReady(options: WatchFolderLoadOptions = {}): Promise<void> {
    await initialLoad(options);
}
