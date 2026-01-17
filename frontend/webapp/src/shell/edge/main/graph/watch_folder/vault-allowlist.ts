/**
 * Vault path management.
 *
 * Handles CRUD operations for vault paths:
 * - Managing the write path (main vault for new node creation)
 * - Managing readOnLinkPaths (additional paths for linking)
 * - Resolving path configuration for a project
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
 * Resolve a writePath to an absolute path.
 * If writePath is relative, it's resolved against watchedFolder.
 * If writePath is absolute, it's returned unchanged.
 */
export function resolveWritePath(watchedFolder: string, writePath: string): string {
    return path.isAbsolute(writePath)
        ? writePath
        : path.join(watchedFolder, writePath);
}

/**
 * Get all vault paths (writePath + readOnLinkPaths).
 * Reads directly from config file (source of truth).
 */
export async function getVaultPaths(): Promise<readonly FilePath[]> {
    const watchedDir: FilePath | null = getWatchedDirectory();
    if (!watchedDir) return [];
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (!config) return [];
    // Return writePath + all readOnLinkPaths
    const resolvedWritePath: string = resolveWritePath(watchedDir, config.writePath);
    return [resolvedWritePath, ...config.readOnLinkPaths];
}

/**
 * Get the write path (where new nodes are created).
 * Reads directly from config file (source of truth).
 * Falls back to the watched directory if not explicitly set.
 */
export async function getWritePath(): Promise<O.Option<FilePath>> {
    const watchedDir: FilePath | null = getWatchedDirectory();
    if (!watchedDir) return O.none;
    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);
    if (config?.writePath) {
        return O.some(resolveWritePath(watchedDir, config.writePath));
    }
    // Fallback to watched directory
    return O.some(watchedDir);
}

/**
 * Set the write path.
 */
export async function setWritePath(vaultPath: FilePath): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getWatchedDirectory();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: VaultConfig | undefined = await getVaultConfigForDirectory(watchedDir);

    // Save to config (source of truth)
    await saveVaultConfigForDirectory(watchedDir, {
        writePath: vaultPath,
        readOnLinkPaths: config?.readOnLinkPaths ?? []
    });

    // Notify backend so it writes new nodes to the correct directory
    notifyTextToTreeServerOfDirectory(vaultPath);

    return { success: true };
}

/**
 * Add a vault path to readOnLinkPaths.
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
    const currentReadOnLinkPaths: readonly string[] = config?.readOnLinkPaths ?? [];
    const currentWritePath: string = config?.writePath ?? watchedDir;

    // Check if already in readOnLinkPaths or is the writePath
    const resolvedWritePath: string = resolveWritePath(watchedDir, currentWritePath);
    if (currentReadOnLinkPaths.includes(vaultPath) || vaultPath === resolvedWritePath) {
        return { success: false, error: 'Path already in allowlist' };
    }

    // Create directory if it doesn't exist (matching loadFolder behavior)
    try {
        await fs.mkdir(vaultPath, { recursive: true });
    } catch (err) {
        return { success: false, error: `Failed to create directory: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }

    const newReadOnLinkPaths: readonly string[] = [...currentReadOnLinkPaths, vaultPath];

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
        writePath: currentWritePath,
        readOnLinkPaths: newReadOnLinkPaths
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
 * Remove a vault path from readOnLinkPaths.
 * Cannot remove the write path.
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

    const resolvedWritePath: string = resolveWritePath(watchedDir, config.writePath);

    // Cannot remove the write path
    if (vaultPath === resolvedWritePath) {
        return { success: false, error: 'Cannot remove write path' };
    }

    if (!config.readOnLinkPaths.includes(vaultPath)) {
        return { success: false, error: 'Path not in allowlist' };
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

    const newReadOnLinkPaths: readonly string[] = config.readOnLinkPaths.filter((p: string) => p !== vaultPath);

    // Save to config (source of truth)
    await saveVaultConfigForDirectory(watchedDir, {
        writePath: config.writePath,
        readOnLinkPaths: newReadOnLinkPaths
    });

    return { success: true };
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
): Promise<{ allowlist: readonly string[]; writePath: string } | null> {
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

    // Filter readOnLinkPaths to those that still exist on disk
    const validReadOnLinkPaths: string[] = [];
    for (const savedPath of savedVaultConfig.readOnLinkPaths) {
        const absolutePath: string = path.isAbsolute(savedPath)
            ? savedPath
            : path.join(watchedDir, savedPath);
        try {
            await fs.access(absolutePath);
            validReadOnLinkPaths.push(absolutePath);
        } catch {
            // Path no longer exists on disk, skip
        }
    }

    // Return combined allowlist (writePath + readOnLinkPaths) for backwards compatibility
    return {
        allowlist: [absoluteWritePath, ...validReadOnLinkPaths],
        writePath: absoluteWritePath
    };
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
