/**
 * BF-161 · async enricher that composes a full `@vt/graph-state` State
 * from main-accessible sources + the mutable live parts in `live-state-store`.
 *
 * Responsibilities split:
 *   • `live-state-store.getCurrentLiveState()` — sync, returns `collapseSet`,
 *     `selection`, `revision`, and `graph` but leaves `roots`/`folderTree`/
 *     `layout.positions` as empty placeholders (BF-162 dispatch path).
 *   • `buildLiveStateSnapshot()` (this file, BF-161) — awaits the filesystem-
 *     backed pieces (vault allowlist + directory tree) and overlays
 *     `layout.positions` harvested from the graph.
 *
 * The output is a fully populated State that `serializeState()` can turn into
 * `SerializedState` so the CLI `vt-graph live view` consumer can hydrate it.
 */
import {
    buildFolderTree,
    getDirectoryTree,
    getProjectRootWatchedDirectory,
    getReadPaths,
    getVaultPaths,
    getWritePath,
    toAbsolutePath,
} from '@vt/graph-model'
import type {
    AbsolutePath,
    DirectoryEntry,
    FolderTreeNode,
} from '@vt/graph-model'
import type { FilePath, Graph, NodeIdAndFilePath, Position } from '@vt/graph-model/pure/graph'
import { collectLayoutPositions } from '@vt/graph-state'
import type { State } from '@vt/graph-state'
import * as O from 'fp-ts/lib/Option.js'

import { getCurrentLiveState } from './live-state-store'

async function buildRoots(
    graph: Graph,
): Promise<{ loaded: ReadonlySet<string>; folderTree: readonly FolderTreeNode[] }> {
    const projectRoot: FilePath | null = getProjectRootWatchedDirectory()
    if (!projectRoot) {
        return { loaded: new Set<string>(), folderTree: [] }
    }

    const vaultPaths: readonly FilePath[] = await getVaultPaths()
    const readPaths: readonly FilePath[] = await getReadPaths()
    const writePathOption: O.Option<FilePath> = await getWritePath()
    const writePath: AbsolutePath | null = O.isSome(writePathOption)
        ? toAbsolutePath(writePathOption.value)
        : null

    const graphFilePaths: ReadonlySet<string> = new Set(
        Object.keys(graph.nodes) as readonly NodeIdAndFilePath[],
    )

    const loaded: ReadonlySet<string> = new Set<string>([...readPaths, ...vaultPaths])

    try {
        const directoryEntry: DirectoryEntry = await getDirectoryTree(projectRoot)
        const tree: FolderTreeNode = buildFolderTree(
            directoryEntry,
            loaded,
            writePath,
            graphFilePaths,
        )
        return { loaded, folderTree: [tree] }
    } catch {
        return { loaded, folderTree: [] }
    }
}

export async function buildLiveStateSnapshot(): Promise<State> {
    const base: State = getCurrentLiveState()
    const { loaded, folderTree } = await buildRoots(base.graph)
    const positions: ReadonlyMap<NodeIdAndFilePath, Position> =
        collectLayoutPositions(base.graph) as ReadonlyMap<NodeIdAndFilePath, Position>

    return {
        graph: base.graph,
        roots: {
            loaded,
            folderTree,
        },
        collapseSet: base.collapseSet,
        selection: base.selection,
        layout: {
            positions,
            ...(base.layout.zoom !== undefined ? { zoom: base.layout.zoom } : {}),
            ...(base.layout.pan !== undefined ? { pan: base.layout.pan } : {}),
            ...(base.layout.fit !== undefined ? { fit: base.layout.fit } : {}),
        },
        meta: {
            schemaVersion: base.meta.schemaVersion,
            revision: base.meta.revision,
            mutatedAt: new Date().toISOString(),
        },
    }
}
