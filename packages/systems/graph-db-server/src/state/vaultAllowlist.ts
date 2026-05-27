/**
 * Vault path management.
 *
 * Handles CRUD operations for vault paths:
 * - Managing the write path (main vault for new node creation)
 * - Managing active-view expanded folder paths
 * - Resolving path configuration for a project
 */

import { promises as fs } from "fs";
import normalizePath from "normalize-path";
export { resolveWriteFolder, type ResolvedVaultConfig, resolveAllowlistForProject } from '../data/watch-folder/paths/resolve-vault-config';
export {
    loadAndMergeVaultPath,
    describeVaultLoadFailure,
    type LoadVaultPathOptions,
    type VaultLoadOutcome,
    type FileLimitDetails,
} from '../data/graph/loading/loadAndMergeVaultPath';
import {
    logIgnoredLegacyReadPathsIfPresent,
    resolveWriteFolder,
} from '../data/watch-folder/paths/resolve-vault-config';
import {
    loadAndMergeVaultPath,
    describeVaultLoadFailure,
    type VaultLoadOutcome,
} from '../data/graph/loading/loadAndMergeVaultPath';
import { traceGraphdSpan } from "../data/watch-folder/paths/traceGraphdSpan";
import type { FSWatcher } from "chokidar";
import * as O from "fp-ts/lib/Option.js";
import type { FilePath, Graph, GraphDelta, DeleteNode, Position } from '@vt/graph-model/graph';
import type { VaultConfig } from '@vt/graph-model/settings';
import { createDatedSubfolder } from "@vt/app-config/project";
import { getGraph } from "./graph-store";
import {
    getProjectRoot,
    setProjectRoot,
    getWatcher,
    emitReadPathsChanged,
} from "./watch-folder-store";
import {
    applyGraphDeltaToMemState,
    refreshGraphChangeSideEffects
} from "../data/graph/mutations/applyGraphDelta";
import { positionsIO } from "@vt/app-config/positions-io";
import {
    getVaultConfigForDirectory,
    saveVaultConfigForDirectory,
} from "@vt/app-config/vault-config";
import { broadcastVaultState } from "../data/watch-folder/broadcast/broadcast-vault-state";
import {getCallbacks} from '@vt/graph-model';
import {
    getExpandedFolderPathsForVault,
    seedActiveViewExpandedFolderStates,
    setActiveViewFolderState,
} from "../data/watch-folder/folder-visibility-active-view";

/**
 * Get all vault paths (writeFolder + active-view expanded paths).
 * All paths are normalized to forward slashes for cross-platform consistency.
 */
export async function getVaultPaths(): Promise<readonly FilePath[]> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) return [];
    await logIgnoredLegacyReadPathsIfPresent(watchedDir);
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config) return [];
    const resolvedWriteFolder: string = resolveWriteFolder(watchedDir, config.writeFolder);
    const expandedPaths: readonly FilePath[] = await getReadPaths();
    const uniqueExpandedPaths: readonly string[] = expandedPaths.filter((p: string) => p !== resolvedWriteFolder);
    return [resolvedWriteFolder, ...uniqueExpandedPaths];
}

/**
 * Get the active view's expanded folder paths.
 * All paths are normalized to forward slashes for cross-platform consistency.
 */
export async function getReadPaths(): Promise<readonly FilePath[]> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) return [];
    const expandedPaths: readonly FilePath[] = await getExpandedFolderPathsForVault(watchedDir);
    return expandedPaths.map((p: string) => resolveWriteFolder(watchedDir, p));
}

/**
 * Get the write path (where new nodes are created).
 * Reads directly from config file (source of truth).
 * Falls back to the watched directory if not explicitly set.
 * Path is normalized to forward slashes for cross-platform consistency.
 */
export async function getWriteFolder(): Promise<O.Option<FilePath>> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) return O.none;
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (config?.writeFolder) {
        return O.some(resolveWriteFolder(watchedDir, config.writeFolder));
    }
    // Fallback to watched directory (normalized)
    return O.some(normalizePath(watchedDir));
}

/**
 * Set the write path.
 *
 * When setting a new write path, all nodes from that path are fully loaded.
 * This ensures the write path behaves like an "immediate load" path.
 *
 * @deprecated Use `setWriteFolder` from `watch-folder/watchFolder`
 * instead. The new verb demotes the previous writeFolder to `collapsed`
 * (matching openspec § D5) rather than `expanded`. Will be removed in
 * `watch-folder-verb-consolidation` Phase 5.
 */
export async function setWriteFolder(
    vaultPath: FilePath,
    options: { createStarterIfEmpty?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const [config, positions]: [VaultConfig | undefined, ReadonlyMap<string, Position>] = await Promise.all([
        traceGraphdSpan('daemon.set-write-folder.get-vault-config', async () => await getVaultConfigForDirectory(watchedDir)),
        traceGraphdSpan('daemon.set-write-folder.load-positions', async (span) => {
            const loadedPositions: ReadonlyMap<string, Position> = await positionsIO.load(watchedDir);
            span.setAttribute('positions.count', loadedPositions.size);
            return loadedPositions;
        }),
    ]);

    // Load and merge handles everything: graph state, UI broadcast, backend notification, starter node
    const outcome: VaultLoadOutcome = await traceGraphdSpan('daemon.set-write-folder.load-and-merge-vault-path', async () => await loadAndMergeVaultPath(
        vaultPath,
        { isWriteFolder: true, createStarterIfEmpty: options.createStarterIfEmpty },
        positions,
    ));
    if (outcome.kind !== 'ok') {
        return { success: false, error: describeVaultLoadFailure(outcome) };
    }

    // Demote old write path to the active view's expanded paths before overwriting
    const oldWriteFolder: string = config?.writeFolder
        ? resolveWriteFolder(watchedDir, config.writeFolder)
        : normalizePath(watchedDir);

    if (oldWriteFolder !== vaultPath) {
        await traceGraphdSpan('daemon.set-write-folder.set-active-view-folder-state', async () => {
            await setActiveViewFolderState(watchedDir, oldWriteFolder, 'expanded');
        });
    }

    await traceGraphdSpan('daemon.set-write-folder.seed-write-path-folder-visibility', async () => {
        await seedActiveViewExpandedFolderStates(watchedDir, [normalizePath(vaultPath)]);
    });

    // Save to config only AFTER successful load (atomic operation)
    await traceGraphdSpan('daemon.set-write-folder.save-vault-config', async () => {
        await saveVaultConfigForDirectory(watchedDir, {
            writeFolder: vaultPath,
        });
    });

    const vaultPaths: readonly FilePath[] = await traceGraphdSpan('daemon.set-write-folder.get-vault-paths-for-emit', async () => await getVaultPaths());
    emitReadPathsChanged(vaultPaths);

    // Note: Clearing the old write path is handled by the caller (VaultPathSelector)
    // which calls removeReadPath() after setWriteFolder()

    await traceGraphdSpan('daemon.set-write-folder.broadcast-vault-state', async () => {
        await broadcastVaultState();
    });
    return { success: true };
}

/**
 * Add a path to the active view's expanded folder paths.
 * If the path doesn't exist, it will be created.
 * Automatically loads ALL files from the new path into the graph and adds to watcher.
 *
 * Uses bulk load path (loadVaultPathAdditively) for efficiency:
 * - Single UI broadcast instead of N broadcasts
 * - No floating editors auto-opened (bulk load behavior)
 * - All files are loaded immediately (not lazy)
 *
 * @deprecated Use `setFolderState(path, 'expanded')` from
 * `watch-folder/watchFolder` instead. Will be removed in
 * `watch-folder-verb-consolidation` Phase 5.
 */
export async function addReadPath(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    const currentWriteFolder: string = config?.writeFolder ?? watchedDir;
    const currentExpandedPaths: readonly FilePath[] = await getReadPaths();

    // Check if already expanded or is the writeFolder
    const resolvedWriteFolder: string = resolveWriteFolder(watchedDir, currentWriteFolder);
    if (currentExpandedPaths.includes(vaultPath) || vaultPath === resolvedWriteFolder) {
        return { success: false, error: 'Path already expanded' };
    }

    // Create directory if it doesn't exist (matching loadFolder behavior)
    try {
        await fs.mkdir(vaultPath, { recursive: true });
    } catch (err) {
        return { success: false, error: `Failed to create directory: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }

    const positions: ReadonlyMap<string, Position> = await positionsIO.load(watchedDir);

    // Load and merge handles everything: graph state, UI broadcast
    // Note: isWriteFolder: false means no starter node and no backend notification
    const outcome: VaultLoadOutcome = await loadAndMergeVaultPath(vaultPath, { isWriteFolder: false }, positions);
    if (outcome.kind === 'fileLimit') {
        // File limit exceeded: still save to config and broadcast so sidebar shows the folder
        await setActiveViewFolderState(watchedDir, vaultPath, 'expanded');
        await broadcastVaultState();
        return { success: false, error: describeVaultLoadFailure(outcome) };
    }
    if (outcome.kind === 'failed') {
        return { success: false, error: outcome.reason };
    }

    // Only save visibility and add to watcher AFTER successful load
    await setActiveViewFolderState(watchedDir, vaultPath, 'expanded');
    await saveVaultConfigForDirectory(watchedDir, {
        writeFolder: currentWriteFolder,
    });

    emitReadPathsChanged(await getVaultPaths());

    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        currentWatcher.add(vaultPath);
    }

    await broadcastVaultState();
    return { success: true };
}

/**
 * Remove a path from the active view's expanded folder paths.
 * Cannot remove the write path.
 * Immediately removes nodes from that path from the graph.
 *
 * @deprecated Use `setFolderState(path, 'unloaded')` from
 * `watch-folder/watchFolder` instead. Will be removed in
 * `watch-folder-verb-consolidation` Phase 5.
 */
export async function removeReadPath(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    // Normalize input path for consistent comparisons (nodeIds use forward slashes)
    const normalizedVaultPath: string = normalizePath(vaultPath);

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config) {
        return { success: false, error: 'No vault config found' };
    }

    const resolvedWriteFolder: string = resolveWriteFolder(watchedDir, config.writeFolder);

    // Cannot remove the current write path
    if (normalizedVaultPath === resolvedWriteFolder) {
        return { success: false, error: 'Cannot remove write path' };
    }

    // Note: We don't check if path is expanded because this function
    // is also used to clear the old write path when editing it to a new location.
    // The old write path may never have been expanded, so we must allow removing it.

    // Remove nodes from the graph that belong to this vault path
    const currentGraph: Graph = getGraph();

    // Build list of paths that should be KEPT (current writeFolder + remaining expanded paths)
    // Exclude the path we're removing so its nodes can be deleted
    // Normalize all paths for consistent comparison with nodeIds (which use forward slashes)
    const remainingExpandedPaths: readonly string[] = (await getReadPaths())
        .filter((p: string) => normalizePath(p) !== normalizedVaultPath)
        .map((p: string) => normalizePath(p));
    const pathsToKeep: readonly string[] = [resolvedWriteFolder, ...remainingExpandedPaths];

    // Helper to check if a nodeId is inside any of the paths to keep
    const isInPathToKeep: (nodeId: string) => boolean = (nodeId: string): boolean => {
        return pathsToKeep.some(keepPath =>
            nodeId.startsWith(keepPath + '/') || nodeId === keepPath
        );
    };

    // Find nodes whose ID starts with this vault's absolute path (node IDs are absolute file paths)
    // BUT exclude nodes that are inside paths we want to keep
    const nodesToRemove: readonly string[] = Object.keys(currentGraph.nodes).filter(nodeId =>
        (nodeId.startsWith(normalizedVaultPath + '/') || nodeId === normalizedVaultPath) &&
        !isInPathToKeep(nodeId)
    );

    if (nodesToRemove.length > 0) {
        // Create delete deltas for each node
        const deleteDelta: GraphDelta = nodesToRemove.map((nodeId): DeleteNode => ({
            type: 'DeleteNode',
            nodeId,
            deletedNode: O.some(currentGraph.nodes[nodeId])
        }));

        // Apply to memory state and broadcast to UI (but NOT to DB - files still exist)
        await applyGraphDeltaToMemState(deleteDelta);
        refreshGraphChangeSideEffects();

        // Fit viewport to remaining nodes after vault removal
        getCallbacks().fitViewport?.();
    }

    // Stop watching the removed path
    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        currentWatcher.unwatch(vaultPath);
    }

    await setActiveViewFolderState(watchedDir, vaultPath, 'hidden');

    // Save write path to config (visibility is sqlite-backed)
    await saveVaultConfigForDirectory(watchedDir, {
        writeFolder: config.writeFolder,
    });

    emitReadPathsChanged(await getVaultPaths());

    await broadcastVaultState();
    return { success: true };
}

/**
 * Create a new dated voicetree folder and set it as the write path.
 * Replaces the current write folder: unwatches it completely (neither read nor write).
 * Also loads all starred folders as read paths.
 */
export async function createDatedVoiceTreeFolder(): Promise<{
    success: boolean; path?: string; error?: string;
}> {
    const watchedDir: string | null = getProjectRoot();
    if (!watchedDir) return { success: false, error: 'No project open' };

    // Capture old write path before switching, so we can unwatch it afterward
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    const oldWriteFolder: string | null = config?.writeFolder
        ? resolveWriteFolder(watchedDir, config.writeFolder)
        : null;

    const newPath: string = await createDatedSubfolder(watchedDir);
    await addReadPath(newPath);
    const result: { success: boolean; error?: string } = await setWriteFolder(newPath);
    if (!result.success) return { ...result, path: newPath };

    // Unwatch old write folder completely - neither read nor write
    if (oldWriteFolder && oldWriteFolder !== normalizePath(watchedDir)) {
        await removeReadPath(oldWriteFolder);
    }

    return { success: true, path: newPath };
}

/**
 * Create a new subfolder inside a given parent directory.
 * Returns the absolute path of the created folder.
 */
export async function createSubfolder(parentPath: string, folderName: string): Promise<{
    success: boolean; path?: string; error?: string;
}> {
    if (!folderName || folderName.includes('/') || folderName.includes('\\')) {
        return { success: false, error: 'Invalid folder name' };
    }
    const fullPath: string = normalizePath(parentPath + '/' + folderName);
    try {
        await fs.mkdir(fullPath, { recursive: true });
        return { success: true, path: fullPath };
    } catch (err) {
        return { success: false, error: String(err) };
    }
}
