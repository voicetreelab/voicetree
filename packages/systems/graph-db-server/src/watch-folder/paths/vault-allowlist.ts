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
export { resolveWritePath, type ResolvedVaultConfig, resolveAllowlistForProject } from './resolve-vault-config';
export {
    loadAndMergeVaultPath,
    type LoadVaultPathOptions,
    type LoadVaultPathResult,
} from './load-and-merge-vault-path';
import {
    logIgnoredLegacyReadPathsIfPresent,
    resolveWritePath,
} from './resolve-vault-config';
import { loadAndMergeVaultPath, type LoadVaultPathResult } from './load-and-merge-vault-path';
import { traceGraphdSpan } from "./traceGraphdSpan";
import type { FSWatcher } from "chokidar";
import * as O from "fp-ts/lib/Option.js";
import type { FilePath, Graph, GraphDelta, DeleteNode, Position } from '@vt/graph-model/graph';
import type { VaultConfig } from '@vt/graph-model/settings';
import { createDatedSubfolder } from "@vt/app-config/project";
import { getGraph } from "../../state/graph-store";
import {
    getProjectRootWatchedDirectory,
    setProjectRootWatchedDirectory,
    getWatcher,
    emitReadPathsChanged,
} from "../../state/watch-folder-store";
import {
    applyGraphDeltaToMemState,
    refreshGraphChangeSideEffects
} from "../../graph/applyGraphDelta";
import { loadPositions } from "@vt/app-config/positions";
import {
    getVaultConfigForDirectory,
    saveVaultConfigForDirectory,
} from "@vt/app-config/vault-config";
import { broadcastVaultState } from "../broadcast/broadcast-vault-state";
import {getCallbacks} from '@vt/graph-model';
import {
    getExpandedFolderPathsForVault,
    setActiveViewFolderState,
} from "../folder-visibility-active-view";

/**
 * Get all vault paths (writePath + active-view expanded paths).
 * All paths are normalized to forward slashes for cross-platform consistency.
 */
export async function getVaultPaths(): Promise<readonly FilePath[]> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) return [];
    await logIgnoredLegacyReadPathsIfPresent(watchedDir);
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config) return [];
    const resolvedWritePath: string = resolveWritePath(watchedDir, config.writePath);
    const expandedPaths: readonly FilePath[] = await getReadPaths();
    const uniqueExpandedPaths: readonly string[] = expandedPaths.filter((p: string) => p !== resolvedWritePath);
    return [resolvedWritePath, ...uniqueExpandedPaths];
}

/**
 * Get the active view's expanded folder paths.
 * All paths are normalized to forward slashes for cross-platform consistency.
 */
export async function getReadPaths(): Promise<readonly FilePath[]> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) return [];
    const expandedPaths: readonly FilePath[] = await getExpandedFolderPathsForVault(watchedDir);
    return expandedPaths.map((p: string) => resolveWritePath(watchedDir, p));
}

/**
 * Get the write path (where new nodes are created).
 * Reads directly from config file (source of truth).
 * Falls back to the watched directory if not explicitly set.
 * Path is normalized to forward slashes for cross-platform consistency.
 */
export async function getWritePath(): Promise<O.Option<FilePath>> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) return O.none;
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (config?.writePath) {
        return O.some(resolveWritePath(watchedDir, config.writePath));
    }
    // Fallback to watched directory (normalized)
    return O.some(normalizePath(watchedDir));
}

/**
 * Set the write path.
 *
 * When setting a new write path, all nodes from that path are fully loaded.
 * This ensures the write path behaves like an "immediate load" path.
 */
export async function setWritePath(
    vaultPath: FilePath,
    options: { createStarterIfEmpty?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const [config, positions]: [VaultConfig | undefined, ReadonlyMap<string, Position>] = await Promise.all([
        traceGraphdSpan('daemon.set-write-path.get-vault-config', async () => await getVaultConfigForDirectory(watchedDir)),
        traceGraphdSpan('daemon.set-write-path.load-positions', async (span) => {
            const loadedPositions: ReadonlyMap<string, Position> = await loadPositions(watchedDir);
            span.setAttribute('positions.count', loadedPositions.size);
            return loadedPositions;
        }),
    ]);

    // Load and merge handles everything: graph state, UI broadcast, backend notification, starter node
    const result: LoadVaultPathResult = await traceGraphdSpan('daemon.set-write-path.load-and-merge-vault-path', async () => await loadAndMergeVaultPath(
        vaultPath,
        { isWritePath: true, createStarterIfEmpty: options.createStarterIfEmpty },
        positions,
    ));
    if (!result.success) {
        return result;
    }

    // Demote old write path to the active view's expanded paths before overwriting
    const oldWritePath: string = config?.writePath
        ? resolveWritePath(watchedDir, config.writePath)
        : normalizePath(watchedDir);

    if (oldWritePath !== vaultPath) {
        await traceGraphdSpan('daemon.set-write-path.set-active-view-folder-state', async () => {
            await setActiveViewFolderState(watchedDir, oldWritePath, 'expanded');
        });
    }

    // Save to config only AFTER successful load (atomic operation)
    await traceGraphdSpan('daemon.set-write-path.save-vault-config', async () => {
        await saveVaultConfigForDirectory(watchedDir, {
            writePath: vaultPath,
        });
    });

    const vaultPaths: readonly FilePath[] = await traceGraphdSpan('daemon.set-write-path.get-vault-paths-for-emit', async () => await getVaultPaths());
    emitReadPathsChanged(vaultPaths);

    // Note: Clearing the old write path is handled by the caller (VaultPathSelector)
    // which calls removeReadPath() after setWritePath()

    await traceGraphdSpan('daemon.set-write-path.broadcast-vault-state', async () => {
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
 */
export async function addReadPath(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    const currentWritePath: string = config?.writePath ?? watchedDir;
    const currentExpandedPaths: readonly FilePath[] = await getReadPaths();

    // Check if already expanded or is the writePath
    const resolvedWritePath: string = resolveWritePath(watchedDir, currentWritePath);
    if (currentExpandedPaths.includes(vaultPath) || vaultPath === resolvedWritePath) {
        return { success: false, error: 'Path already expanded' };
    }

    // Create directory if it doesn't exist (matching loadFolder behavior)
    try {
        await fs.mkdir(vaultPath, { recursive: true });
    } catch (err) {
        return { success: false, error: `Failed to create directory: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }

    const positions: ReadonlyMap<string, Position> = await loadPositions(watchedDir);

    // Load and merge handles everything: graph state, UI broadcast
    // Note: isWritePath: false means no starter node and no backend notification
    const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: false }, positions);
    if (!result.success) {
        // File limit exceeded: still save to config and broadcast so sidebar shows the folder
        if (result.error?.includes('File limit exceeded')) {
            await setActiveViewFolderState(watchedDir, vaultPath, 'expanded');
            await broadcastVaultState();
        }
        return result;
    }

    // Only save visibility and add to watcher AFTER successful load
    await setActiveViewFolderState(watchedDir, vaultPath, 'expanded');
    await saveVaultConfigForDirectory(watchedDir, {
        writePath: currentWritePath,
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
 */
export async function removeReadPath(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    // Normalize input path for consistent comparisons (nodeIds use forward slashes)
    const normalizedVaultPath: string = normalizePath(vaultPath);

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config) {
        return { success: false, error: 'No vault config found' };
    }

    const resolvedWritePath: string = resolveWritePath(watchedDir, config.writePath);

    // Cannot remove the current write path
    if (normalizedVaultPath === resolvedWritePath) {
        return { success: false, error: 'Cannot remove write path' };
    }

    // Note: We don't check if path is expanded because this function
    // is also used to clear the old write path when editing it to a new location.
    // The old write path may never have been expanded, so we must allow removing it.

    // Remove nodes from the graph that belong to this vault path
    const currentGraph: Graph = getGraph();

    // Build list of paths that should be KEPT (current writePath + remaining expanded paths)
    // Exclude the path we're removing so its nodes can be deleted
    // Normalize all paths for consistent comparison with nodeIds (which use forward slashes)
    const remainingExpandedPaths: readonly string[] = (await getReadPaths())
        .filter((p: string) => normalizePath(p) !== normalizedVaultPath)
        .map((p: string) => normalizePath(p));
    const pathsToKeep: readonly string[] = [resolvedWritePath, ...remainingExpandedPaths];

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
        writePath: config.writePath,
    });

    emitReadPathsChanged(await getVaultPaths());

    await broadcastVaultState();
    return { success: true };
}

// Returns the watched directory (project root), normalized to forward slashes.
// For the actual write path where new files are created, use getWritePath() instead.
export function getVaultPath(): O.Option<FilePath> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) return O.none;
    return O.some(normalizePath(watchedDir));
}

// For external callers (MCP) - sets the vault path directly
export function setVaultPath(vaultPath: FilePath): void {
    setProjectRootWatchedDirectory(vaultPath);
}

/**
 * Create a new dated voicetree folder and set it as the write path.
 * Replaces the current write folder: unwatches it completely (neither read nor write).
 * Also loads all starred folders as read paths.
 */
export async function createDatedVoiceTreeFolder(): Promise<{
    success: boolean; path?: string; error?: string;
}> {
    const watchedDir: string | null = getProjectRootWatchedDirectory();
    if (!watchedDir) return { success: false, error: 'No project open' };

    // Capture old write path before switching, so we can unwatch it afterward
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    const oldWritePath: string | null = config?.writePath
        ? resolveWritePath(watchedDir, config.writePath)
        : null;

    const newPath: string = await createDatedSubfolder(watchedDir);
    await addReadPath(newPath);
    const result: { success: boolean; error?: string } = await setWritePath(newPath);
    if (!result.success) return { ...result, path: newPath };

    // Unwatch old write folder completely - neither read nor write
    if (oldWritePath && oldWritePath !== normalizePath(watchedDir)) {
        await removeReadPath(oldWritePath);
    }

    return { success: true, path: newPath };
}

export function clearVaultPath(): void {
    setProjectRootWatchedDirectory(null);
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
