import * as O from 'fp-ts/lib/Option.js'

import { applyGraphDeltaToGraph, createEmptyGraph } from '@vt/graph-model'
import type { FolderTreeNode, Graph, GraphDelta, NodeIdAndFilePath, Position } from '@vt/graph-model'

import type { ProjectedGraph, State } from '@vt/graph-state/contract'
import { emptyState } from '@vt/graph-state/emptyState'
import { project } from '@vt/graph-state/project'
import { getSelection } from '@vt/graph-state/state/selectionStore'

import {
    getGraphCollapseSet,
    getFolderTreeState,
    subscribeFolderTree,
} from '@/shell/edge/UI-edge/state/stores/FolderTreeStore'

interface TestProjectionState {
    graph: Graph
    revision: number
    positions: Map<NodeIdAndFilePath, Position>
}

const state: TestProjectionState = {
    graph: createEmptyGraph(),
    revision: 0,
    positions: new Map(),
}

let lastSyncedFolderTree: FolderTreeNode | null = getFolderTreeState().tree
let hasFreshFolderTree: boolean = lastSyncedFolderTree !== null

function emptyRoots(): State['roots'] {
    return {
        loaded: new Set<string>(),
        folderTree: [],
    }
}

function buildRoots(tree: FolderTreeNode): State['roots'] {
    return {
        loaded: new Set<string>([tree.absolutePath]),
        folderTree: [tree],
    }
}

function buildRootsFromFolderTree(): State['roots'] {
    if (!hasFreshFolderTree) return emptyRoots()

    const tree: FolderTreeNode | null = getFolderTreeState().tree
    if (!tree) return emptyRoots()

    return buildRoots(tree)
}

function buildProjectionState(): State {
    const base: State = emptyState()
    return {
        ...base,
        graph: state.graph,
        roots: buildRootsFromFolderTree(),
        collapseSet: getGraphCollapseSet(),
        selection: getSelection(),
        layout: {
            ...base.layout,
            positions: state.positions,
        },
        meta: { ...base.meta, revision: state.revision },
    }
}

function updatePositionsFromDelta(delta: GraphDelta): void {
    for (const op of delta) {
        if (op.type === 'UpsertNode') {
            const node: typeof op.nodeToUpsert = op.nodeToUpsert
            if (O.isSome(node.nodeUIMetadata.position)) {
                state.positions.set(node.absoluteFilePathIsID, node.nodeUIMetadata.position.value)
            }
        } else if (op.type === 'DeleteNode') {
            state.positions.delete(op.nodeId)
        }
    }
}

export function applyDeltaToTestProjectionState(delta: GraphDelta): void {
    if (delta.length === 0) return
    state.graph = applyGraphDeltaToGraph(state.graph, delta)
    updatePositionsFromDelta(delta)
    state.revision += 1
}

export function projectDelta(delta: GraphDelta): ProjectedGraph {
    applyDeltaToTestProjectionState(delta)
    return projectTestProjectionState()
}

export function resetTestProjectionState(): void {
    state.graph = createEmptyGraph()
    state.revision = 0
    state.positions = new Map()
    hasFreshFolderTree = false
    lastSyncedFolderTree = null
}

export function projectTestProjectionState(): ProjectedGraph {
    return project(buildProjectionState())
}

subscribeFolderTree(({ tree }: { tree: FolderTreeNode | null }) => {
    if (tree === lastSyncedFolderTree) return
    lastSyncedFolderTree = tree
    hasFreshFolderTree = tree !== null
    state.revision += 1
})
