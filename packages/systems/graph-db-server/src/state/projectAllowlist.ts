/**
 * Project path management.
 *
 * Handles CRUD operations for project paths:
 * - Managing the write path (main project for new node creation)
 * - Managing active-view expanded folder paths
 * - Resolving path configuration for a project
 */

import { promises as fs } from "fs";
import normalizePath from "normalize-path";
export { resolveWriteFolderPath, type ResolvedProjectConfig, resolveAllowlistForProject } from '../data/watch-folder/paths/resolve-project-config';
export {
    loadAndMergeProjectPath,
    describeProjectLoadFailure,
    type LoadProjectPathOptions,
    type ProjectLoadOutcome,
    type FileLimitDetails,
} from '../data/graph/loading/loadAndMergeProjectPath';
import {
    logIgnoredLegacyReadPathsIfPresent,
    resolveWriteFolderPath,
} from '../data/watch-folder/paths/resolve-project-config';
import {
    loadAndMergeProjectPath,
    describeProjectLoadFailure,
    type ProjectLoadOutcome,
} from '../data/graph/loading/loadAndMergeProjectPath';
import { traceGraphdSpan } from "../data/watch-folder/paths/traceGraphdSpan";
import type { FSWatcher } from "chokidar";
import * as O from "fp-ts/lib/Option.js";
import type { FilePath, Graph, GraphDelta, DeleteNode, NodeLayout } from '@vt/graph-model/graph';
import type { ProjectConfig } from '@vt/graph-model/settings';
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
import { nodeLayoutIO } from "@vt/app-config/node-layout-io";
import {
    getProjectConfigForDirectory,
    saveProjectConfigForDirectory,
} from "@vt/app-config/project-config";
import { broadcastProjectState } from "../data/watch-folder/broadcast/broadcast-project-state";
import {getCallbacks} from '@vt/graph-model';
import {
    getExpandedFolderPathsForProject,
    markActiveViewFolderHidden,
    seedActiveViewExpandedFolderStates,
    setActiveViewFolderState,
} from "../data/watch-folder/folder-visibility-active-view";
import { getFolderStateForActiveView } from "../data/views/folderStateOps";

/**
 * Get all project paths (writeFolderPath + active-view expanded paths).
 * All paths are normalized to forward slashes for cross-platform consistency.
 */
export async function getProjectPaths(): Promise<readonly FilePath[]> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) return [];
    await logIgnoredLegacyReadPathsIfPresent(watchedDir);
    const config: ProjectConfig | undefined = await getProjectConfigForDirectory(watchedDir);
    if (!config) return [];
    const resolvedWriteFolderPath: string = resolveWriteFolderPath(watchedDir, config.writeFolderPath);
    const expandedPaths: readonly FilePath[] = await getReadPaths();
    const uniqueExpandedPaths: readonly string[] = expandedPaths.filter((p: string) => p !== resolvedWriteFolderPath);
    return [resolvedWriteFolderPath, ...uniqueExpandedPaths];
}

/**
 * Get the active view's expanded folder paths.
 * All paths are normalized to forward slashes for cross-platform consistency.
 */
export async function getReadPaths(): Promise<readonly FilePath[]> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) return [];
    const expandedPaths: readonly FilePath[] = await getExpandedFolderPathsForProject(watchedDir);
    return expandedPaths.map((p: string) => resolveWriteFolderPath(watchedDir, p));
}

/**
 * Get the write path (where new nodes are created).
 * Reads directly from config file (source of truth).
 * Falls back to the watched directory if not explicitly set.
 * Path is normalized to forward slashes for cross-platform consistency.
 */
export async function getWriteFolderPath(): Promise<O.Option<FilePath>> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) return O.none;
    const config: ProjectConfig | undefined = await getProjectConfigForDirectory(watchedDir);
    if (config?.writeFolderPath) {
        return O.some(resolveWriteFolderPath(watchedDir, config.writeFolderPath));
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
 * @deprecated Use `setWriteFolderPath` from `watch-folder/watchFolder`
 * instead. The new verb demotes the previous writeFolderPath to `collapsed`
 * (matching openspec § D5) rather than `expanded`. Will be removed in
 * `watch-folder-verb-consolidation` Phase 5.
 */
export async function setWriteFolderPath(
    projectPath: FilePath,
    options: { createStarterIfEmpty?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const [config, nodeLayout]: [ProjectConfig | undefined, ReadonlyMap<string, NodeLayout>] = await Promise.all([
        traceGraphdSpan('daemon.set-write-folder-path.get-project-config', async () => await getProjectConfigForDirectory(watchedDir)),
        traceGraphdSpan('daemon.set-write-folder-path.load-node-layout', async (span) => {
            const loadedLayout: ReadonlyMap<string, NodeLayout> = await nodeLayoutIO.load(watchedDir);
            span.setAttribute('nodeLayout.count', loadedLayout.size);
            return loadedLayout;
        }),
    ]);

    // Load and merge handles everything: graph state, UI broadcast, backend notification, starter node
    const outcome: ProjectLoadOutcome = await traceGraphdSpan('daemon.set-write-folder-path.load-and-merge-project-path', async () => await loadAndMergeProjectPath(
        projectPath,
        { isWriteFolderPath: true, createStarterIfEmpty: options.createStarterIfEmpty },
        nodeLayout,
    ));
    if (outcome.kind !== 'ok') {
        return { success: false, error: describeProjectLoadFailure(outcome) };
    }

    // Demote the previously-saved writeFolderPath to the active view's expanded
    // paths before overwriting. Only meaningful when a prior writeFolderPath
    // actually exists — on a cold open with no saved config there is no
    // "previous" to demote, and treating the projectRoot as one would seed a
    // spurious expanded row whenever the new writeFolderPath is a subfolder.
    if (config?.writeFolderPath) {
        const oldWriteFolderPath: string = resolveWriteFolderPath(watchedDir, config.writeFolderPath);
        if (oldWriteFolderPath !== projectPath) {
            await traceGraphdSpan('daemon.set-write-folder-path.set-active-view-folder-state', async () => {
                await setActiveViewFolderState(watchedDir, oldWriteFolderPath, 'expanded');
            });
        }
    }

    await traceGraphdSpan('daemon.set-write-folder-path.seed-write-path-folder-visibility', async () => {
        await seedActiveViewExpandedFolderStates(watchedDir, [normalizePath(projectPath)]);
    });

    // Save to config only AFTER successful load (atomic operation)
    await traceGraphdSpan('daemon.set-write-folder-path.save-project-config', async () => {
        await saveProjectConfigForDirectory(watchedDir, {
            writeFolderPath: projectPath,
        });
    });

    const projectPaths: readonly FilePath[] = await traceGraphdSpan('daemon.set-write-folder-path.get-project-paths-for-emit', async () => await getProjectPaths());
    emitReadPathsChanged(projectPaths);

    // Note: Clearing the old write path is handled by the caller (ProjectPathSelector)
    // which calls removeReadPath() after setWriteFolderPath()

    await traceGraphdSpan('daemon.set-write-folder-path.broadcast-project-state', async () => {
        await broadcastProjectState();
    });
    return { success: true };
}

/**
 * Add a path to the active view's expanded folder paths.
 * If the path doesn't exist, it will be created.
 * Automatically loads ALL files from the new path into the graph and adds to watcher.
 *
 * Uses bulk load path (loadProjectPathAdditively) for efficiency:
 * - Single UI broadcast instead of N broadcasts
 * - No floating editors auto-opened (bulk load behavior)
 * - All files are loaded immediately (not lazy)
 *
 * @deprecated Use `setFolderState(path, 'expanded')` from
 * `watch-folder/watchFolder` instead. Will be removed in
 * `watch-folder-verb-consolidation` Phase 5.
 */
export async function addReadPath(projectPath: FilePath): Promise<{ success: boolean; error?: string }> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) {
        return { success: false, error: 'No directory is being watched' };
    }

    const config: ProjectConfig | undefined = await getProjectConfigForDirectory(watchedDir);
    const currentWriteFolderPath: string = config?.writeFolderPath ?? watchedDir;
    const currentExpandedPaths: readonly FilePath[] = await getReadPaths();

    // Check if already expanded or is the writeFolderPath
    const resolvedWriteFolderPath: string = resolveWriteFolderPath(watchedDir, currentWriteFolderPath);
    if (currentExpandedPaths.includes(projectPath) || projectPath === resolvedWriteFolderPath) {
        return { success: false, error: 'Path already expanded' };
    }

    // Create directory if it doesn't exist (matching loadFolder behavior)
    try {
        await fs.mkdir(projectPath, { recursive: true });
    } catch (err) {
        return { success: false, error: `Failed to create directory: ${err instanceof Error ? err.message : 'Unknown error'}` };
    }

    const nodeLayout: ReadonlyMap<string, NodeLayout> = await nodeLayoutIO.load(watchedDir);

    // Load and merge handles everything: graph state, UI broadcast
    // Note: isWriteFolderPath: false means no starter node and no backend notification
    const outcome: ProjectLoadOutcome = await loadAndMergeProjectPath(projectPath, { isWriteFolderPath: false }, nodeLayout);
    if (outcome.kind === 'fileLimit') {
        // File limit exceeded: still save to config and broadcast so sidebar shows the folder
        await setActiveViewFolderState(watchedDir, projectPath, 'expanded');
        await broadcastProjectState();
        return { success: false, error: describeProjectLoadFailure(outcome) };
    }
    if (outcome.kind === 'failed') {
        return { success: false, error: outcome.reason };
    }

    // Only save visibility and add to watcher AFTER successful load
    await setActiveViewFolderState(watchedDir, projectPath, 'expanded');
    await saveProjectConfigForDirectory(watchedDir, {
        writeFolderPath: currentWriteFolderPath,
    });

    emitReadPathsChanged(await getProjectPaths());

    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        currentWatcher.add(projectPath);
    }

    await broadcastProjectState();
    return { success: true };
}

/**
 * Pure predicate: the ids of all graph nodes that live under `folder` and are
 * not kept alive by a loaded ancestor in `keptPaths` (the write folder + the
 * still-expanded read paths).
 *
 * This is the single removal rule for the unload transition (`removeReadPath`)
 * and the reconcile-on-load purge (`reconcileHiddenFolders`). Node ids are
 * absolute file paths normalized with forward slashes.
 */
export function nodesUnderFolderNotKept(
    graph: Graph,
    folder: FilePath,
    keptPaths: readonly FilePath[],
): readonly string[] {
    const normalizedFolder: string = normalizePath(folder);
    const normalizedKept: readonly string[] = keptPaths.map((p: string) => normalizePath(p));
    const isKept: (nodeId: string) => boolean = (nodeId: string): boolean =>
        normalizedKept.some((keep: string) => nodeId.startsWith(keep + '/') || nodeId === keep);
    return Object.keys(graph.nodes).filter((nodeId: string) =>
        (nodeId.startsWith(normalizedFolder + '/') || nodeId === normalizedFolder) &&
        !isKept(nodeId)
    );
}

/**
 * Remove `nodeIds` from the in-memory graph and broadcast the deletion.
 * Memory-only by design (the backing files survive an unload — unload ≠ delete).
 * Returns the number of nodes actually removed.
 */
async function purgeNodesFromGraph(nodeIds: readonly string[]): Promise<number> {
    if (nodeIds.length === 0) return 0;
    const currentGraph: Graph = getGraph();
    const deleteDelta: GraphDelta = nodeIds.map((nodeId): DeleteNode => ({
        type: 'DeleteNode',
        nodeId,
        deletedNode: O.some(currentGraph.nodes[nodeId]),
    }));
    await applyGraphDeltaToMemState(deleteDelta);
    refreshGraphChangeSideEffects();
    return nodeIds.length;
}

/**
 * Unload transition: the single funnel through which a folder reaches the
 * `'hidden'` visibility state. It purges the folder's graph nodes (memory-only)
 * and writes `'hidden'` to folder-visibility as one unit, returning the count of
 * nodes removed so a caller/UI can detect a no-op purge.
 *
 * Cannot unload the write path. Also used to clear an old write path when it is
 * relocated, so it does not require the path to currently be expanded.
 *
 * @deprecated Use `setFolderState(path, 'unloaded')` from
 * `watch-folder/watchFolder` instead. Will be removed in
 * `watch-folder-verb-consolidation` Phase 5.
 */
export async function removeReadPath(
    projectPath: FilePath,
): Promise<{ success: boolean; removedNodeCount: number; error?: string }> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) {
        return { success: false, removedNodeCount: 0, error: 'No directory is being watched' };
    }

    // Normalize input path for consistent comparisons (nodeIds use forward slashes)
    const normalizedProjectPath: string = normalizePath(projectPath);

    const config: ProjectConfig | undefined = await getProjectConfigForDirectory(watchedDir);
    if (!config) {
        return { success: false, removedNodeCount: 0, error: 'No project config found' };
    }

    const resolvedWriteFolderPath: string = resolveWriteFolderPath(watchedDir, config.writeFolderPath);

    // Cannot remove the current write path
    if (normalizedProjectPath === resolvedWriteFolderPath) {
        return { success: false, removedNodeCount: 0, error: 'Cannot remove write path' };
    }

    // Build the set of paths whose nodes must be KEPT (write folder + the
    // expanded read paths other than the one being removed) and purge every
    // node under the removed folder that is not held alive by one of them.
    const remainingExpandedPaths: readonly string[] = (await getReadPaths())
        .filter((p: string) => normalizePath(p) !== normalizedProjectPath);
    const pathsToKeep: readonly string[] = [resolvedWriteFolderPath, ...remainingExpandedPaths];
    const nodesToRemove: readonly string[] = nodesUnderFolderNotKept(getGraph(), projectPath, pathsToKeep);

    const removedNodeCount: number = await purgeNodesFromGraph(nodesToRemove);
    if (removedNodeCount > 0) {
        // Fit viewport to remaining nodes after the purge
        getCallbacks().fitViewport?.();
    }

    // Stop watching the removed path
    const currentWatcher: FSWatcher | null = getWatcher();
    if (currentWatcher) {
        currentWatcher.unwatch(projectPath);
    }

    await markActiveViewFolderHidden(watchedDir, projectPath);

    // Save write path to config (visibility is sqlite-backed)
    await saveProjectConfigForDirectory(watchedDir, {
        writeFolderPath: config.writeFolderPath,
    });

    emitReadPathsChanged(await getProjectPaths());

    await broadcastProjectState();
    return { success: true, removedNodeCount };
}

/**
 * Reconcile-on-load purge: enforce INV-1 across the whole project after a
 * (re)load. Drops every graph node that belongs to a `'hidden'` folder and is
 * not kept alive by a loaded ancestor (the write folder or a still-expanded
 * read path) — healing any drift where a hidden folder's nodes lingered (e.g.
 * dragged back in by link resolution).
 *
 * This is the unload transition's removal rule (`nodesUnderFolderNotKept`)
 * lifted from "the one folder being unloaded" to "every hidden folder", applied
 * once as a single memory-only delta. Returns the number of nodes removed.
 *
 * Must run AFTER read-path expansion so an expanded sub-path of an otherwise
 * hidden tree is respected by the kept-paths set.
 */
export async function reconcileHiddenFolders(): Promise<{ removedNodeCount: number }> {
    const watchedDir: FilePath | null = getProjectRoot();
    if (!watchedDir) return { removedNodeCount: 0 };

    const { folderState } = getFolderStateForActiveView(watchedDir);
    const hiddenFolders: readonly string[] = folderState
        .filter(([, state]) => state === 'hidden')
        .map(([folderPath]) => folderPath);
    if (hiddenFolders.length === 0) return { removedNodeCount: 0 };

    const config: ProjectConfig | undefined = await getProjectConfigForDirectory(watchedDir);
    const resolvedWriteFolderPath: string = resolveWriteFolderPath(watchedDir, config?.writeFolderPath ?? watchedDir);
    const expandedPaths: readonly string[] = await getReadPaths();
    const pathsToKeep: readonly string[] = [resolvedWriteFolderPath, ...expandedPaths];

    const currentGraph: Graph = getGraph();
    const nodesToRemove: readonly string[] = [
        ...new Set(
            hiddenFolders.flatMap((folder: string) =>
                nodesUnderFolderNotKept(currentGraph, folder, pathsToKeep),
            ),
        ),
    ];

    const removedNodeCount: number = await purgeNodesFromGraph(nodesToRemove);
    return { removedNodeCount };
}

/**
 * Create a new dated voicetree folder and set it as the write path.
 * Replaces the current write folder path: unwatches it completely (neither read nor write).
 * Also loads all starred folders as read paths.
 */
export async function createDatedVoiceTreeFolder(): Promise<{
    success: boolean; path?: string; error?: string;
}> {
    const watchedDir: string | null = getProjectRoot();
    if (!watchedDir) return { success: false, error: 'No project open' };

    // Capture old write path before switching, so we can unwatch it afterward
    const config: ProjectConfig | undefined = await getProjectConfigForDirectory(watchedDir);
    const oldWriteFolderPath: string | null = config?.writeFolderPath
        ? resolveWriteFolderPath(watchedDir, config.writeFolderPath)
        : null;

    const newPath: string = await createDatedSubfolder(watchedDir);
    await addReadPath(newPath);
    const result: { success: boolean; error?: string } = await setWriteFolderPath(newPath);
    if (!result.success) return { ...result, path: newPath };

    // Unwatch old write folder path completely - neither read nor write
    if (oldWriteFolderPath && oldWriteFolderPath !== normalizePath(watchedDir)) {
        await removeReadPath(oldWriteFolderPath);
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
