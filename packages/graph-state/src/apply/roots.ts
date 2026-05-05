import * as E from 'fp-ts/lib/Either.js'
import * as O from 'fp-ts/lib/Option.js'

import {
    applyGraphDeltaToGraph,
    buildFolderTree,
    deleteNodeSimple,
    getDirectoryTree,
    loadGraphFromDisk,
    toAbsolutePath,
    type GraphDelta,
} from '@vt/graph-model'

import type { Delta, LoadRoot, State, UnloadRoot } from '../contract'
import { applySetFolderState } from './folderVisibility'
import type { SetFolderState } from './folderVisibility'
import { findWriteTargetPath } from './folderTreeHelpers'

const DEFAULT_VIEW_ID = 'main'

function applyLegacyFolderStateCommand(
    state: State,
    command: SetFolderState,
): State {
    try {
        return applySetFolderState(state, command)
    } catch (error) {
        if (!isUnconfiguredStoreError(error)) {
            throw error
        }
        return {
            ...state,
            meta: {
                ...state.meta,
                revision: state.meta.revision + 1,
            },
        }
    }
}

function isUnconfiguredStoreError(error: unknown): boolean {
    return error instanceof Error
        && error.message === 'folderVisibilityStore is not configured with a sqlite database'
}

export async function applyLoadRoot(
    state: State,
    command: LoadRoot,
): Promise<{ readonly state: State; readonly delta: Delta }> {
    const root = command.root
    const visibilityState = applyLegacyFolderStateCommand(state, {
        type: 'SetFolderState',
        viewId: DEFAULT_VIEW_ID,
        path: root,
        state: 'expanded',
    })
    const nextRevision = visibilityState.meta.revision

    if (state.roots.loaded.has(root)) {
        return {
            state: { ...state, meta: visibilityState.meta },
            delta: { revision: nextRevision, cause: command, rootsLoaded: [] },
        }
    }

    const loadResult = await loadGraphFromDisk([root])
    if (E.isLeft(loadResult)) {
        throw new Error(`LoadRoot failed for "${root}": ${JSON.stringify(loadResult.left)}`)
    }
    const loadedGraph = loadResult.right

    // Merge: left-bias — keep existing nodes on collision
    const addedNodes: GraphDelta = Object.entries(loadedGraph.nodes)
        .filter(([nodeId]) => !state.graph.nodes[nodeId])
        .map(([, node]) => ({
            type: 'UpsertNode' as const,
            nodeToUpsert: node,
            previousNode: O.none,
        }))

    const graph = addedNodes.length > 0
        ? applyGraphDeltaToGraph(state.graph, addedNodes)
        : state.graph

    const newLoaded = new Set([...state.roots.loaded, root])
    const writePath = findWriteTargetPath(state.roots.folderTree)
    const directoryTree = await getDirectoryTree(root)
    const graphFilePaths = new Set(Object.keys(graph.nodes))
    const newFolderTreeEntry = buildFolderTree(
        directoryTree,
        newLoaded,
        writePath,
        graphFilePaths,
    )
    const folderTree = [...state.roots.folderTree, newFolderTreeEntry]

    return {
        state: {
            ...state,
            graph,
            roots: { loaded: newLoaded, folderTree },
            meta: visibilityState.meta,
        },
        delta: {
            revision: nextRevision,
            cause: command,
            rootsLoaded: [root],
            ...(addedNodes.length > 0 ? { graph: addedNodes } : {}),
        },
    }
}

export function applyUnloadRoot(
    state: State,
    command: UnloadRoot,
): { readonly state: State; readonly delta: Delta } {
    const root = command.root
    const visibilityState = applyLegacyFolderStateCommand(state, {
        type: 'SetFolderState',
        viewId: DEFAULT_VIEW_ID,
        path: root,
        state: 'hidden',
    })
    const nextRevision = visibilityState.meta.revision

    if (!state.roots.loaded.has(root)) {
        return {
            state: { ...state, meta: visibilityState.meta },
            delta: { revision: nextRevision, cause: command, rootsUnloaded: [] },
        }
    }

    const rootPrefix = `${root}/`
    const nodeIdsToRemove = Object.keys(state.graph.nodes)
        .filter((id) => id === root || id.startsWith(rootPrefix))

    let graph = state.graph
    let allGraphDeltas: GraphDelta = []
    for (const nodeId of nodeIdsToRemove) {
        const delta = deleteNodeSimple(graph, nodeId)
        if (delta.length > 0) {
            graph = applyGraphDeltaToGraph(graph, delta)
            allGraphDeltas = [...allGraphDeltas, ...delta]
        }
    }

    const nextSelection = new Set(
        [...state.selection].filter((id) => !id.startsWith(rootPrefix) && id !== root),
    )
    const positions = new Map(
        [...state.layout.positions].filter(([id]) => !id.startsWith(rootPrefix) && id !== root),
    )
    const nextCollapseSet = new Set(
        [...state.collapseSet].filter((id) => !id.startsWith(rootPrefix) && id !== root),
    )

    const nextLoaded = new Set([...state.roots.loaded].filter((r) => r !== root))
    const nextFolderTree = state.roots.folderTree.filter((t) => t.absolutePath !== root)

    return {
        state: {
            graph,
            roots: { loaded: nextLoaded, folderTree: nextFolderTree },
            collapseSet: nextCollapseSet,
            selection: nextSelection,
            layout: { ...state.layout, positions },
            meta: visibilityState.meta,
        },
        delta: {
            revision: nextRevision,
            cause: command,
            rootsUnloaded: [root],
            ...(allGraphDeltas.length > 0 ? { graph: allGraphDeltas } : {}),
        },
    }
}
