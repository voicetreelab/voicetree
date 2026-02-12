/**
 * Vault path management.
 *
 * Handles CRUD operations for vault paths:
 * - Managing the write path (main vault for new node creation)
 * - Managing readPaths (additional directories that are fully loaded)
 * - Resolving path configuration for a project
 */

import path from "path";
import { promises as fs } from "fs";
import normalizePath from "normalize-path";
import type { FSWatcher } from "chokidar";
import * as O from "fp-ts/lib/Option.js";
import type { FilePath, Graph, GraphDelta, DeleteNode } from "@/pure/graph";
import { applyGraphDeltaToGraph } from "@/pure/graph";
import type { VaultConfig } from "@/pure/settings/types";
import { loadVaultPathAdditively, resolveLinkedNodesInWatchedFolder } from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk";
import { createStarterNode } from "./create-starter-node";
import type { FileLimitExceededError } from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce";
import * as E from "fp-ts/lib/Either.js";
import { setGraph, getGraph } from "@/shell/edge/main/state/graph-store";
import {
    getProjectRootWatchedDirectory,
    setProjectRootWatchedDirectory,
    getWatcher,
} from "@/shell/edge/main/state/watch-folder-store";
import {
    applyGraphDeltaToMemState,
    broadcastGraphDeltaToUI
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/applyGraphDeltaToDBThroughMemAndUI";
import { notifyTextToTreeServerOfDirectory } from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/notifyTextToTreeServerOfDirectory";
import { uiAPI } from "@/shell/edge/main/ui-api-proxy";
import {
    getVaultConfigForDirectory,
    saveVaultConfigForDirectory,
} from "./voicetree-config-io";

/**
 * Options for loading a vault path into the graph
 */
export interface LoadVaultPathOptions {
  /**
   * Whether this path is the write path (main vault for new node creation).
   * When true and the folder is empty:
   * - Creates a starter node
   * - Notifies backend of write directory
   */
  isWritePath: boolean;
}

/**
 * Simple result type for impure edge functions.
 */
export type LoadVaultPathResult = {
    success: boolean;
    error?: string;
};

/**
 * Resolve a writePath to an absolute path with normalized separators.
 * If writePath is relative, it's resolved against watchedFolder.
 * If writePath is absolute, it's returned unchanged.
 * Always normalizes to forward slashes for cross-platform consistency.
 */
export function resolveWritePath(watchedFolder: string, writePath: string): string {
    const resolved: string = path.isAbsolute(writePath)
        ? writePath
        : path.join(watchedFolder, writePath);
    return normalizePath(resolved);
}

/**
 * Get all vault paths (writePath + readPaths).
 * Reads directly from config file (source of truth).
 * All paths are normalized to forward slashes for cross-platform consistency.
 */
export async function getVaultPaths(): Promise<readonly FilePath[]> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) return [];
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config) return [];
    // Return writePath + all readPaths (all normalized, deduplicated)
    const resolvedWritePath: string = resolveWritePath(watchedDir, config.writePath);
    const normalizedReadPaths: readonly string[] = config.readPaths.map((p: string) => normalizePath(p));
    // Deduplicate: filter out readPaths that match writePath
    const uniqueReadPaths: readonly string[] = normalizedReadPaths.filter((p: string) => p !== resolvedWritePath);
    return [resolvedWritePath, ...uniqueReadPaths];
}

/**
 * Get the readPaths array (additional paths for reading, not including writePath).
 * Reads directly from config file (source of truth).
 * All paths are normalized to forward slashes for cross-platform consistency.
 */
export async function getReadPaths(): Promise<readonly FilePath[]> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) return [];
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config) return [];
    return config.readPaths.map((p: string) => normalizePath(p));
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
 * Load files from a vault path and merge into the existing graph.
 *
 * IMPURE EDGE FUNCTION: Handles all side effects internally.
 * Shared by setWritePath, addReadPath, loadFolder, and createNewWorkspaceOnFileLimitExceeded.
 *
 * Handles internally:
 * - Reads current graph from global state (getGraph)
 * - Reads project root from global state (getProjectRootWatchedDirectory)
 * - Loads files and resolves wikilinks
 * - Creates starter node for empty write paths
 * - Commits to graph store (setGraph)
 * - Broadcasts to UI (broadcastGraphDeltaToUI)
 * - Notifies backend for write paths (notifyTextToTreeServerOfDirectory)
 *
 * @param vaultPath - The path to load
 * @param options - Loading options including isWritePath flag
 */
export async function loadAndMergeVaultPath(
    vaultPath: FilePath,
    options: LoadVaultPathOptions = { isWritePath: false }
): Promise<LoadVaultPathResult> {
    // Read dependencies from global state (impure edge)
    const existingGraph: Graph = getGraph();
    const watchedFolderPath: FilePath | null = getProjectRootWatchedDirectory();

    const loadResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
        await loadVaultPathAdditively(vaultPath, existingGraph);

    if (E.isLeft(loadResult)) {
        return {
            success: false,
            error: `File limit exceeded: ${loadResult.left.fileCount} files (max: ${loadResult.left.maxFiles})`
        };
    }

    let currentGraph: Graph = loadResult.right.graph;
    let accumulatedDelta: GraphDelta = loadResult.right.delta;

    // Resolve wikilinks for loaded files
    if (watchedFolderPath) {
        const resolutionDelta: GraphDelta = await resolveLinkedNodesInWatchedFolder(currentGraph, watchedFolderPath);
        if (resolutionDelta.length > 0) {
            currentGraph = applyGraphDeltaToGraph(currentGraph, resolutionDelta);
            accumulatedDelta = [...accumulatedDelta, ...resolutionDelta];
        }
    }

    // Handle starter node creation for empty write paths
    if (options.isWritePath) {
        const nodesInPath: readonly string[] = Object.keys(currentGraph.nodes).filter(nodeId =>
            nodeId.startsWith(vaultPath + '/') || nodeId === vaultPath
        );
        if (nodesInPath.length === 0) {
            const starterGraph: Graph = await createStarterNode(vaultPath);
            currentGraph = { ...currentGraph, nodes: { ...currentGraph.nodes, ...starterGraph.nodes } };
            const starterNodeId: string = Object.keys(starterGraph.nodes)[0];
            if (starterNodeId) {
                accumulatedDelta = [...accumulatedDelta, {
                    type: 'CreateNode' as const,
                    nodeId: starterNodeId,
                    createdNode: starterGraph.nodes[starterNodeId]
                }];
            }
        }
    }

    // Commit side effects (impure - this is the edge)
    setGraph(currentGraph);
    if (accumulatedDelta.length > 0) {
        broadcastGraphDeltaToUI(accumulatedDelta);
    }
    if (options.isWritePath) {
        notifyTextToTreeServerOfDirectory(vaultPath);
    }

    return { success: true };
}

/**
 * Set the write path.
 *
 * When setting a new write path, all nodes from that path are fully loaded.
 * This ensures the write path behaves like an "immediate load" path.
 */
export async function setWritePath(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getProjectRootWatchedDirectory();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);

    // Load and merge handles everything: graph state, UI broadcast, backend notification, starter node
    const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: true });
    if (!result.success) {
        return result;
    }

    // Demote old write path to readPaths before overwriting
    const oldWritePath: string = config?.writePath
        ? resolveWritePath(watchedDir, config.writePath)
        : normalizePath(watchedDir);

    // Build new readPaths: remove new writePath if present, add old writePath
    const newReadPaths: readonly string[] = (config?.readPaths ?? [])
        .filter((p: string) => p !== vaultPath)
        .concat(oldWritePath !== vaultPath ? [oldWritePath] : []);

    // Save to config only AFTER successful load (atomic operation)
    await saveVaultConfigForDirectory(watchedDir, {
        writePath: vaultPath,
        readPaths: newReadPaths
    });

    return { success: true };
}

/**
 * Add a path to readPaths.
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
    const currentReadPaths: readonly string[] = config?.readPaths ?? [];
    const currentWritePath: string = config?.writePath ?? watchedDir;

    // Check if already in readPaths or is the writePath
    const resolvedWritePath: string = resolveWritePath(watchedDir, currentWritePath);
    if (currentReadPaths.includes(vaultPath) || vaultPath === resolvedWritePath) {
        return { success: false, error: 'Path already in readPaths' };
    }

    // Create directory if it doesn't exist (matching loadFolder behavior)
    try {
        await fs.mkdir(vaultPath, { recursive: true });
    } catch (err) {
        return { success: false, error: `Failed to create directory: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }

    // Load and merge handles everything: graph state, UI broadcast
    // Note: isWritePath: false means no starter node and no backend notification
    const result: LoadVaultPathResult = await loadAndMergeVaultPath(vaultPath, { isWritePath: false });
    if (!result.success) {
        return result;
    }

    // Only save config and add to watcher AFTER successful load
    const newReadPaths: readonly string[] = [...currentReadPaths, vaultPath];
    await saveVaultConfigForDirectory(watchedDir, {
        writePath: currentWritePath,
        readPaths: newReadPaths
    });

    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        currentWatcher.add(vaultPath);
    }

    return { success: true };
}

/**
 * Remove a path from readPaths.
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

    // Note: We don't check if path is in readPaths because this function
    // is also used to clear the old write path when editing it to a new location.
    // The old write path was never in readPaths, so we must allow removing it.

    // Remove nodes from the graph that belong to this vault path
    const currentGraph: Graph = getGraph();

    // Build list of paths that should be KEPT (current writePath + remaining readPaths)
    // Exclude the path we're removing so its nodes can be deleted
    // Normalize all paths for consistent comparison with nodeIds (which use forward slashes)
    const remainingReadPaths: readonly string[] = config.readPaths
        .filter((p: string) => normalizePath(p) !== normalizedVaultPath)
        .map((p: string) => normalizePath(p));
    const pathsToKeep: readonly string[] = [resolvedWritePath, ...remainingReadPaths];

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
        const mergedDelta: GraphDelta = await applyGraphDeltaToMemState(deleteDelta);
        broadcastGraphDeltaToUI(mergedDelta);

        // Fit viewport to remaining nodes after vault removal
        uiAPI.fitViewport();
    }

    // Stop watching the removed path
    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        currentWatcher.unwatch(vaultPath);
    }

    const newReadPaths: readonly string[] = config.readPaths.filter((p: string) => p !== vaultPath);

    // Save to config (source of truth)
    await saveVaultConfigForDirectory(watchedDir, {
        writePath: config.writePath,
        readPaths: newReadPaths
    });

    return { success: true };
}

/**
 * Resolved vault configuration for loading.
 */
export interface ResolvedVaultConfig {
    /** Combined allowlist (writePath + readPaths) for backwards compatibility */
    readonly allowlist: readonly string[];
    /** Main vault path for writing new nodes */
    readonly writePath: string;
    /** readPaths (excluding writePath) */
    readonly readPaths: readonly string[];
}

/**
 * Resolve the vault path configuration for a project.
 *
 * If saved vault config exists, it is authoritative - use it directly.
 * This ensures user changes persist across reloads.
 *
 * If no saved config, return null so caller can attempt loading directly.
 */
export async function resolveAllowlistForProject(
    watchedDir: string
): Promise<ResolvedVaultConfig | null> {
    const savedVaultConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);

    // If no saved config exists, return null so caller can attempt loading directly
    if (!savedVaultConfig?.writePath) {
        return null;
    }

    // Resolve writePath to absolute
    const absoluteWritePath: string = resolveWritePath(watchedDir, savedVaultConfig.writePath);

    // Check if writePath still exists on disk
    try {
        await fs.access(absoluteWritePath);
    } catch {
        // Write path no longer exists, return null to retry fresh
        return null;
    }

    // Filter readPaths to those that still exist on disk
    // Normalize all paths to forward slashes for cross-platform consistency
    const validReadPaths: string[] = [];
    for (const savedPath of savedVaultConfig.readPaths) {
        const absolutePath: string = normalizePath(
            path.isAbsolute(savedPath)
                ? savedPath
                : path.join(watchedDir, savedPath)
        );
        // Skip if same as writePath (deduplicate)
        if (absolutePath === absoluteWritePath) continue;
        try {
            await fs.access(absolutePath);
            validReadPaths.push(absolutePath);
        } catch {
            // Path no longer exists on disk, skip
        }
    }

    return {
        allowlist: [absoluteWritePath, ...validReadPaths],
        writePath: absoluteWritePath,
        readPaths: validReadPaths
    };
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

export function clearVaultPath(): void {
    setProjectRootWatchedDirectory(null);
}
