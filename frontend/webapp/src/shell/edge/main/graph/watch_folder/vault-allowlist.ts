/**
 * Vault allowlist management.
 *
 * Handles CRUD operations for the vault allowlist:
 * - Adding/removing vault paths from the allowlist
 * - Managing the write path (where new nodes are created)
 * - Resolving allowlist configuration for a project
 */

import path from "path";
import { promises as fs } from "fs";
import type { FSWatcher } from "chokidar";
import * as O from "fp-ts/lib/Option.js";
import * as E from "fp-ts/lib/Either.js";
import type { FilePath, Graph, GraphDelta, DeleteNode } from "@/pure/graph";
import type { FileLimitExceededError } from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/fileLimitEnforce";
import type { VaultConfig } from "@/pure/settings/types";
import { loadVaultPathAdditively } from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onFSEventIsDbChangePath/loadGraphFromDisk";
import { setGraph, getGraph } from "@/shell/edge/main/state/graph-store";
import {
    getWatchedDirectory,
    setWatchedDirectory,
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
 * Get all vault paths in the allowlist.
 * Reads directly from config file (source of truth).
 */
export async function getVaultPaths(): Promise<readonly FilePath[]> {
    const watchedDir: FilePath | null = getWatchedDirectory();
    if (!watchedDir) return [];
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    return config?.allowlist ?? [];
}

/**
 * Get the write path (where new nodes are created).
 * Reads directly from config file (source of truth).
 * Falls back to the primary vault path if not explicitly set.
 */
export async function getWritePath(): Promise<O.Option<FilePath>> {
    const watchedDir: FilePath | null = getWatchedDirectory();
    if (!watchedDir) return O.none;
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (config?.writePath) {
        return O.some(config.writePath);
    }
    // Fallback to primary vault path (backward compatibility)
    return getVaultPath();
}

/**
 * Set the write path. Must be in the allowlist.
 */
export async function setWritePath(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getWatchedDirectory();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config) {
        return { success: false, error: 'No vault config found' };
    }

    if (!config.allowlist.includes(vaultPath)) {
        return { success: false, error: 'Path must be in the allowlist' };
    }

    // Save to config (source of truth)
    await saveVaultConfigForDirectory(watchedDir, {
        allowlist: config.allowlist,
        writePath: vaultPath
    });

    // Notify backend so it writes new nodes to the correct directory
    notifyTextToTreeServerOfDirectory(vaultPath);

    return { success: true };
}

/**
 * Add a vault path to the allowlist.
 * If the path doesn't exist, it will be created.
 * Automatically loads files from the new path into the graph and adds to watcher.
 *
 * Uses bulk load path (loadVaultPathAdditively) for efficiency:
 * - Single UI broadcast instead of N broadcasts
 * - No floating editors auto-opened (bulk load behavior)
 * - Consistent with initial loadGraphFromDisk pattern
 */
export async function addVaultPathToAllowlist(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getWatchedDirectory();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config) {
        return { success: false, error: 'No vault config found' };
    }

    // Check if already in allowlist
    if (config.allowlist.includes(vaultPath)) {
        return { success: false, error: 'Path already in allowlist' };
    }

    // Create directory if it doesn't exist (matching loadFolder behavior)
    try {
        await fs.mkdir(vaultPath, { recursive: true });
    } catch (err) {
        return { success: false, error: `Failed to create directory: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }

    const newAllowlist: readonly string[] = [...config.allowlist, vaultPath];

    // Load files from the new path into the graph using bulk load path
    const existingGraph: Graph = getGraph();

    // Use bulk load path: single pass, single broadcast, no editors auto-opened
    const loadResult: E.Either<FileLimitExceededError, { graph: Graph; delta: GraphDelta }> =
        await loadVaultPathAdditively(vaultPath, existingGraph);

    if (E.isLeft(loadResult)) {
        return { success: false, error: `File limit exceeded: ${loadResult.left.fileCount} files` };
    }

    // Save to config (source of truth)
    await saveVaultConfigForDirectory(watchedDir, {
        allowlist: newAllowlist,
        writePath: config.writePath
    });

    const { graph: mergedGraph, delta } = loadResult.right;

    // Update graph state
    setGraph(mergedGraph);

    // Single broadcast to UI (no editors auto-opened for bulk loads)
    if (delta.length > 0) {
        applyGraphDeltaToMemState(delta);
        broadcastGraphDeltaToUI(delta);
    }

    // Add the new path to the watcher
    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        currentWatcher.add(vaultPath);
    }

    return { success: true };
}

/**
 * Remove a vault path from the allowlist.
 * Cannot remove the default write path.
 * Immediately removes nodes from that vault from the graph.
 */
export async function removeVaultPathFromAllowlist(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getWatchedDirectory();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config) {
        return { success: false, error: 'No vault config found' };
    }

    if (!config.allowlist.includes(vaultPath)) {
        return { success: false, error: 'Path not in allowlist' };
    }

    if (vaultPath === config.writePath) {
        return { success: false, error: 'Cannot remove write path' };
    }

    // Remove nodes from the graph that belong to this vault path
    const currentGraph: Graph = getGraph();

    // Find nodes whose ID starts with this vault's absolute path (node IDs are absolute file paths)
    const nodesToRemove: readonly string[] = Object.keys(currentGraph.nodes).filter(nodeId =>
        nodeId.startsWith(vaultPath + path.sep) || nodeId === vaultPath
    );

    if (nodesToRemove.length > 0) {
        // Create delete deltas for each node
        const deleteDelta: GraphDelta = nodesToRemove.map((nodeId): DeleteNode => ({
            type: 'DeleteNode',
            nodeId,
            deletedNode: O.some(currentGraph.nodes[nodeId])
        }));

        // Apply to memory state and broadcast to UI (but NOT to DB - files still exist)
        applyGraphDeltaToMemState(deleteDelta);
        broadcastGraphDeltaToUI(deleteDelta);

        // Fit viewport to remaining nodes after vault removal
        uiAPI.fitViewport();
    }

    const newAllowlist: readonly string[] = config.allowlist.filter((p: string) => p !== vaultPath);

    // Save to config (source of truth)
    await saveVaultConfigForDirectory(watchedDir, {
        allowlist: newAllowlist,
        writePath: config.writePath
    });

    return { success: true };
}

/**
 * Resolve the full vault path allowlist for a project.
 *
 * If saved vault config exists, it is authoritative - use it directly.
 * This ensures user removals persist across reloads.
 *
 * If no saved config, build default allowlist from:
 * 1. The watched directory itself (or auto-created subfolder if file limit exceeded)
 * 2. Global default patterns from settings (e.g., "openspec")
 */
export async function resolveAllowlistForProject(
    watchedDir: string
): Promise<{ allowlist: readonly string[]; writePath: string } | null> {
    const savedVaultConfig: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);

    // If no saved config exists, return null so caller can attempt loading directly
    if (!savedVaultConfig?.allowlist || savedVaultConfig.allowlist.length === 0) {
        return null;
    }

    // Filter to paths that still exist on disk
    // Handle migration: resolve relative paths to absolute
    const allowlist: string[] = [];
    for (const savedPath of savedVaultConfig.allowlist) {
        // Resolve relative paths to absolute using watchedDir as base
        const absolutePath: string = path.isAbsolute(savedPath)
            ? savedPath
            : path.join(watchedDir, savedPath);
        try {
            await fs.access(absolutePath);
            allowlist.push(absolutePath);
        } catch {
            // Path no longer exists on disk, skip
        }
    }

    // If all saved paths were deleted from disk, return null to retry fresh
    if (allowlist.length === 0) {
        return null;
    }

    // Resolve relative write path to absolute
    const absoluteWritePath: string | undefined = savedVaultConfig.writePath
        ? (path.isAbsolute(savedVaultConfig.writePath) ? savedVaultConfig.writePath : path.join(watchedDir, savedVaultConfig.writePath))
        : undefined;

    // Use saved write path if it's still in the allowlist, otherwise use first allowlist entry
    const resolvedWritePath: string =
        absoluteWritePath && allowlist.includes(absoluteWritePath)
            ? absoluteWritePath
            : allowlist[0];

    return { allowlist, writePath: resolvedWritePath };
}

// Returns the watched directory (project root).
// For the actual write path where new files are created, use getWritePath() instead.
export function getVaultPath(): O.Option<FilePath> {
    const watchedDir: FilePath | null = getWatchedDirectory();
    if (!watchedDir) return O.none;
    return O.some(watchedDir);
}

// For external callers (MCP) - sets the vault path directly
export function setVaultPath(vaultPath: FilePath): void {
    setWatchedDirectory(vaultPath);
}

export function clearVaultPath(): void {
    setWatchedDirectory(null);
}
