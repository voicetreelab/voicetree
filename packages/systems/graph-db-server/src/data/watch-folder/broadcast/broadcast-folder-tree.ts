/**
 * Broadcast folder tree to renderer for FolderTreeSidebar.
 * Called after project state changes and file watcher add/unlink events.
 * Debounced to avoid excessive filesystem scans during rapid FS changes.
 */

import { getProjectRoot } from '@vt/graph-db-server/state/watch-folder-store';
import { getProjectPaths, getWriteFolderPath } from '@vt/graph-db-server/state/projectAllowlist';
import { getStarredFolders } from '../starred-folders';
import { getGraph } from '@vt/graph-db-server/state/graph-store';
import { getFolderTreeReadModel } from '@vt/graph-db-server/state/folder-tree-read-model-store';
import { buildFolderTree, getExternalReadPaths } from '@vt/graph-model/folders';
import type { DirectoryEntry } from '@vt/graph-model/folders';
import type { FolderTreeNode, AbsolutePath } from '@vt/graph-model/folders';
import { toAbsolutePath } from '@vt/graph-model/folders';
import type { Graph, NodeIdAndFilePath } from '@vt/graph-model/graph';
import * as O from 'fp-ts/lib/Option.js';
import type { FilePath } from '@vt/graph-model/graph';
import {getCallbacks} from '@vt/graph-model';

const STARRED_AND_EXTERNAL_MAX_DEPTH: number = 3;
const ROOT_TREE_MAX_DEPTH: number = 3;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS: number = 300;

async function doBroadcast(): Promise<void> {
    const projectRoot: FilePath | null = getProjectRoot();
    if (!projectRoot) return;

    const projectPaths: readonly FilePath[] = await getProjectPaths();
    const writeFolderPathOption: O.Option<FilePath> = await getWriteFolderPath();
    const writeFolderPath: AbsolutePath | null = O.isSome(writeFolderPathOption) ? toAbsolutePath(writeFolderPathOption.value) : null;

    const graph: Graph = getGraph();
    const graphFilePaths: Set<string> = new Set(
        Object.keys(graph.nodes) as readonly NodeIdAndFilePath[]
    );

    const loadedPaths: Set<string> = new Set<string>(projectPaths);
    if (writeFolderPath) loadedPaths.add(writeFolderPath);

    const readModel = getFolderTreeReadModel();

    const entry: DirectoryEntry | null = await readModel.readRootTree({
        root: toAbsolutePath(projectRoot),
        maxDepth: ROOT_TREE_MAX_DEPTH,
    });
    if (entry) {
        const tree: FolderTreeNode = buildFolderTree(entry, loadedPaths, writeFolderPath, graphFilePaths);
        getCallbacks().syncFolderTree?.(tree);
    }

    const starredFolders: readonly string[] = await getStarredFolders();
    const starredTrees: Record<string, FolderTreeNode> = {};
    for (const folder of starredFolders) {
        const starredEntry: DirectoryEntry | null = await readModel.readDepthLimitedTree({
            root: toAbsolutePath(folder),
            maxDepth: STARRED_AND_EXTERNAL_MAX_DEPTH,
        });
        if (!starredEntry) continue;
        starredTrees[folder] = buildFolderTree(starredEntry, loadedPaths, writeFolderPath, graphFilePaths);
    }
    getCallbacks().syncStarredFolderTrees?.(starredTrees);

    const externalPaths: readonly string[] = getExternalReadPaths([...projectPaths], projectRoot);
    const externalTrees: Record<string, FolderTreeNode> = {};
    for (const extPath of externalPaths) {
        const extEntry: DirectoryEntry | null = await readModel.readDepthLimitedTree({
            root: toAbsolutePath(extPath),
            maxDepth: STARRED_AND_EXTERNAL_MAX_DEPTH,
        });
        if (!extEntry) continue;
        externalTrees[extPath] = buildFolderTree(extEntry, loadedPaths, writeFolderPath, graphFilePaths);
    }
    getCallbacks().syncExternalFolderTrees?.(externalTrees);
}

export function broadcastFolderTree(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void doBroadcast();
    }, DEBOUNCE_MS);
}

export function broadcastFolderTreeImmediate(): Promise<void> {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    return doBroadcast();
}
