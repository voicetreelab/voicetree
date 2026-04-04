/**
 * Broadcast folder tree to renderer for FolderTreeSidebar.
 * Called after vault state changes and file watcher add/unlink events.
 * Debounced to avoid excessive filesystem scans during rapid FS changes.
 */

import { getProjectRootWatchedDirectory } from '../state/watch-folder-store';
import { getVaultPaths, getWritePath } from './vault-allowlist';
import { getStarredFolders } from './starred-folders';
import { getGraph } from '../state/graph-store';
import { getDirectoryTree } from './folder-scanner';
import { buildFolderTree, getExternalReadPaths } from '@/pure/folders/transforms';
import type { DirectoryEntry } from '@/pure/folders/transforms';
import type { FolderTreeNode, AbsolutePath } from '@/pure/folders/types';
import { toAbsolutePath } from '@/pure/folders/types';
import type { Graph, NodeIdAndFilePath } from '@/pure/graph';
import * as O from 'fp-ts/lib/Option.js';
import type { FilePath } from '@/pure/graph';
import {getCallbacks} from '../types';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS: number = 300;

async function doBroadcast(): Promise<void> {
    const projectRoot: FilePath | null = getProjectRootWatchedDirectory();
    if (!projectRoot) return;

    const readPaths: readonly FilePath[] = await getVaultPaths();
    const writePathOption: O.Option<FilePath> = await getWritePath();
    const writePath: AbsolutePath | null = O.isSome(writePathOption) ? toAbsolutePath(writePathOption.value) : null;

    const graph: Graph = getGraph();
    const graphFilePaths: Set<string> = new Set(
        Object.keys(graph.nodes) as readonly NodeIdAndFilePath[]
    );

    const loadedPaths: Set<string> = new Set<string>(readPaths);
    if (writePath) loadedPaths.add(writePath);

    const entry: DirectoryEntry = await getDirectoryTree(projectRoot);
    const tree: FolderTreeNode = buildFolderTree(entry, loadedPaths, writePath, graphFilePaths);

    getCallbacks().syncFolderTree?.(tree);

    // Scan starred folders and broadcast their trees (depth-limited to 3 for performance)
    const starredFolders: readonly string[] = await getStarredFolders();
    const starredTrees: Record<string, FolderTreeNode> = {};
    for (const folder of starredFolders) {
        try {
            const starredEntry: DirectoryEntry = await getDirectoryTree(folder, 3);
            starredTrees[folder] = buildFolderTree(starredEntry, loadedPaths, writePath, graphFilePaths);
        } catch {
            // Starred folder doesn't exist or can't be read — skip
        }
    }
    getCallbacks().syncStarredFolderTrees?.(starredTrees);

    // Scan external read paths (not under project root) and broadcast their trees
    const externalPaths: readonly string[] = getExternalReadPaths([...readPaths], projectRoot);
    const externalTrees: Record<string, FolderTreeNode> = {};
    for (const extPath of externalPaths) {
        try {
            const extEntry: DirectoryEntry = await getDirectoryTree(extPath, 3);
            externalTrees[extPath] = buildFolderTree(extEntry, loadedPaths, writePath, graphFilePaths);
        } catch {
            // External folder doesn't exist or can't be read — skip
        }
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

export function broadcastFolderTreeImmediate(): void {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    void doBroadcast();
}
