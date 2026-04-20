/**
 * BF-L5-202b · Renderer-side State mirror.
 *
 * Accumulates the subset of @vt/graph-state `State` that the renderer needs to
 * call `project(state)` and produce an `ElementSpec` for the UI-edge
 * reconciler. Keeps `collapseSet` + `selection` in sync with the existing
 * renderer-canonical stores (see renderer/debug/liveState.ts). Derives
 * `layout.positions` from `nodeUIMetadata.position` on every upsert, matching
 * the semantics of `updateLayoutForAddedNode`.
 */

import * as O from 'fp-ts/lib/Option.js'

import { applyGraphDeltaToGraph, createEmptyGraph } from '@vt/graph-model'
import type { FolderTreeNode, Graph, GraphDelta, NodeIdAndFilePath, Position } from '@vt/graph-model'

import {
    emptyState,
    project,
    type ElementSpec,
    type SerializedState,
    type State,
} from '@vt/graph-state'

import { getCollapseSet } from '@vt/graph-state/state/collapseSetStore'
import { getSelection } from '@vt/graph-state/state/selectionStore'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/applyGraphDeltaToUI'
import {
    getFolderTreeState,
    subscribeFolderTree,
} from '@/shell/edge/UI-edge/state/FolderTreeStore'
import {
    getCyInstance,
    isCyInitialized,
} from '@/shell/edge/UI-edge/state/cytoscape-state'

interface MirrorState {
    graph: Graph
    revision: number
    positions: Map<NodeIdAndFilePath, Position>
}

const mirror: MirrorState = {
    graph: createEmptyGraph(),
    revision: 0,
    positions: new Map(),
}

let lastSyncedFolderTree: FolderTreeNode | null = getFolderTreeState().tree
let hasFreshFolderTree: boolean = lastSyncedFolderTree !== null
let folderTreeFromMain: FolderTreeNode | null = null
let loadedRootsFromMain: ReadonlySet<string> | null = null
let isFetchingFolderTreeFromMain = false
let shouldRefetchFolderTreeFromMain = false

function updatePositionsFromDelta(delta: GraphDelta): void {
    for (const op of delta) {
        if (op.type === 'UpsertNode') {
            const node: typeof op.nodeToUpsert = op.nodeToUpsert
            if (O.isSome(node.nodeUIMetadata.position)) {
                mirror.positions.set(node.absoluteFilePathIsID, node.nodeUIMetadata.position.value)
            }
        } else if (op.type === 'DeleteNode') {
            mirror.positions.delete(op.nodeId)
        }
    }
}

function emptyRoots(): State['roots'] {
    return {
        loaded: new Set<string>(),
        folderTree: [],
    }
}

function buildRoots(tree: FolderTreeNode, loaded: ReadonlySet<string> | null): State['roots'] {
    return {
        loaded: loaded ? new Set<string>(loaded) : new Set<string>([tree.absolutePath]),
        folderTree: [tree],
    }
}

function buildRootsFromFolderTree(): State['roots'] {
    if (folderTreeFromMain) {
        return buildRoots(folderTreeFromMain, loadedRootsFromMain)
    }

    if (!hasFreshFolderTree) return emptyRoots()

    const tree: FolderTreeNode | null = getFolderTreeState().tree
    if (!tree) return emptyRoots()

    return buildRoots(tree, null)
}

function getLiveStateSnapshotFromMain():
    | (() => Promise<SerializedState>)
    | undefined {
    if (typeof window === 'undefined') return undefined
    return window.electronAPI?.main?.getLiveStateSnapshot as (() => Promise<SerializedState>) | undefined
}

function coerceFolderTreeFromMain(snapshot: SerializedState): FolderTreeNode | null {
    const root: SerializedState['roots']['folderTree'][number] | undefined = snapshot.roots.folderTree[0]
    return root ? root as FolderTreeNode : null
}

async function refreshFolderTreeFromMain(): Promise<void> {
    const getLiveStateSnapshot: (() => Promise<SerializedState>) | undefined =
        getLiveStateSnapshotFromMain()
    if (typeof getLiveStateSnapshot !== 'function') return

    if (isFetchingFolderTreeFromMain) {
        shouldRefetchFolderTreeFromMain = true
        return
    }

    isFetchingFolderTreeFromMain = true

    try {
        const snapshot: SerializedState = await getLiveStateSnapshot()
        folderTreeFromMain = coerceFolderTreeFromMain(snapshot)
        loadedRootsFromMain = new Set<string>(snapshot.roots.loaded)
        mirror.revision += 1
        refreshProjectionFromStores()
    } catch {
        // Fall back to the renderer-owned FolderTreeStore outside Electron/tests.
    } finally {
        isFetchingFolderTreeFromMain = false
        if (shouldRefetchFolderTreeFromMain) {
            shouldRefetchFolderTreeFromMain = false
            void refreshFolderTreeFromMain()
        }
    }
}

function buildStateFromMirror(): State {
    const base: State = emptyState()
    return {
        ...base,
        graph: mirror.graph,
        roots: buildRootsFromFolderTree(),
        collapseSet: getCollapseSet(),
        selection: getSelection(),
        layout: {
            ...base.layout,
            positions: mirror.positions,
        },
        meta: { ...base.meta, revision: mirror.revision },
    }
}

function refreshProjectionFromStores(): void {
    if (!isCyInitialized()) return
    applyGraphDeltaToUI(getCyInstance(), projectRendererState())
}

export function applyDeltaToRendererStateMirror(delta: GraphDelta): void {
    if (delta.length === 0) return
    mirror.graph = applyGraphDeltaToGraph(mirror.graph, delta)
    updatePositionsFromDelta(delta)
    mirror.revision += 1
    void refreshFolderTreeFromMain()
}

export function resetRendererStateMirror(): void {
    mirror.graph = createEmptyGraph()
    mirror.revision = 0
    mirror.positions = new Map()
    hasFreshFolderTree = false
    lastSyncedFolderTree = null
    folderTreeFromMain = null
    loadedRootsFromMain = null
    isFetchingFolderTreeFromMain = false
    shouldRefetchFolderTreeFromMain = false
}

export function projectRendererState(): ElementSpec {
    return project(buildStateFromMirror())
}

export function projectDelta(delta: GraphDelta): ElementSpec {
    applyDeltaToRendererStateMirror(delta)
    return projectRendererState()
}

subscribeFolderTree(({ tree }: { tree: FolderTreeNode | null }) => {
    if (tree === lastSyncedFolderTree) return
    lastSyncedFolderTree = tree
    hasFreshFolderTree = tree !== null
    mirror.revision += 1
    refreshProjectionFromStores()
})

void refreshFolderTreeFromMain()
