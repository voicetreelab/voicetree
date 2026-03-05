/**
 * Broadcast folder tree to renderer for FolderTreeSidebar.
 * Called after vault state changes and file watcher add/unlink events.
 * Debounced to avoid excessive filesystem scans during rapid FS changes.
 */

import { uiAPI } from '@/shell/edge/main/ui-api-proxy';
import { getProjectRootWatchedDirectory } from '@/shell/edge/main/state/watch-folder-store';
import { getVaultPaths, getWritePath } from './vault-allowlist';
import { getGraph } from '@/shell/edge/main/state/graph-store';
import { getDirectoryTree } from './folder-scanner';
import { buildFolderTree } from '@/pure/folders/transforms';
import type { DirectoryEntry } from '@/pure/folders/transforms';
import type { FolderTreeNode, AbsolutePath } from '@/pure/folders/types';
import { toAbsolutePath } from '@/pure/folders/types';
import type { Graph, NodeIdAndFilePath } from '@/pure/graph';
import * as O from 'fp-ts/lib/Option.js';
import type { FilePath } from '@/pure/graph';

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
    const tree: FolderTreeNode = buildFolderTree(entry, loadedPaths, writePath, new Set(), graphFilePaths);

    uiAPI.syncFolderTree(tree);
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
