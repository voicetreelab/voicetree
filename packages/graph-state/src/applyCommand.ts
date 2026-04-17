import * as O from 'fp-ts/lib/Option.js'

import {
    applyGraphDeltaToGraph,
    createEmptyGraph,
    deleteNodeSimple,
    type GraphDelta,
} from '@vt/graph-model'

import type {
    AddEdge,
    AddNode,
    Collapse,
    Command,
    Delta,
    Deselect,
    Expand,
    LoadRoot,
    Move,
    RemoveEdge,
    RemoveNode,
    Select,
    State,
    UnloadRoot,
} from './contract'
import {
    updateFolderTreeForAddedNode,
    updateFolderTreeForRemovedNode,
    updateLayoutForAddedNode,
    updateLayoutForRemovedNode,
    type EdgeChange,
} from './apply/folderTreeHelpers'
import {
    createEdgesAddedGraphDelta,
    createEdgesRemovedGraphDelta,
    rebuildSourceNodeForRemovedEdge,
} from './apply/markdownEdits'
import { applyMove } from './apply/move'
import { applyLoadRoot, applyUnloadRoot } from './apply/roots'

function applyAddNode(
    state: State,
    command: AddNode,
): { readonly state: State; readonly delta: Delta } {
    const previousNode = O.fromNullable(state.graph.nodes[command.node.absoluteFilePathIsID])
    const graphDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: command.node,
        previousNode,
    }]
    const graph = applyGraphDeltaToGraph(state.graph, graphDelta)
    const node = graph.nodes[command.node.absoluteFilePathIsID]
    const nextRevision = state.meta.revision + 1

    return {
        state: {
            graph,
            roots: updateFolderTreeForAddedNode(state.roots, command.node.absoluteFilePathIsID, graph),
            collapseSet: state.collapseSet,
            selection: state.selection,
            layout: updateLayoutForAddedNode(state.layout, node),
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: { revision: nextRevision, cause: command, graph: graphDelta },
    }
}

function applyRemoveNode(
    state: State,
    command: RemoveNode,
): { readonly state: State; readonly delta: Delta } {
    const nextRevision = state.meta.revision + 1
    const graphDelta: GraphDelta = deleteNodeSimple(state.graph, command.id)
    const graph = graphDelta.length > 0 ? applyGraphDeltaToGraph(state.graph, graphDelta) : state.graph
    const nextSelection = new Set(state.selection)
    const wasSelected = nextSelection.delete(command.id)

    return {
        state: {
            graph,
            roots: updateFolderTreeForRemovedNode(state.roots, command.id, graph),
            collapseSet: state.collapseSet,
            selection: nextSelection,
            layout: updateLayoutForRemovedNode(state.layout, command.id),
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            ...(graphDelta.length > 0 ? { graph: graphDelta } : {}),
            ...(wasSelected ? { selectionRemoved: [command.id] } : {}),
        },
    }
}

function applyAddEdge(
    state: State,
    command: AddEdge,
): { readonly state: State; readonly delta: Delta } {
    const nextRevision = state.meta.revision + 1
    const sourceNode = state.graph.nodes[command.source]

    if (!sourceNode) {
        return {
            state: { ...state, meta: { ...state.meta, revision: nextRevision } },
            delta: { revision: nextRevision, cause: command },
        }
    }

    const alreadyExists = sourceNode.outgoingEdges.some(
        (e) => e.targetId === command.edge.targetId && e.label === command.edge.label,
    )
    if (alreadyExists) {
        return {
            state: { ...state, meta: { ...state.meta, revision: nextRevision } },
            delta: { revision: nextRevision, cause: command },
        }
    }

    const updatedSourceNode = { ...sourceNode, outgoingEdges: [...sourceNode.outgoingEdges, command.edge] }
    const graphMutationDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: updatedSourceNode,
        previousNode: O.some(sourceNode),
    }]
    const graph = applyGraphDeltaToGraph(state.graph, graphMutationDelta)

    const edgeChange: EdgeChange = {
        source: command.source,
        targetId: command.edge.targetId,
        label: command.edge.label,
    }

    return {
        state: {
            graph,
            roots: state.roots,
            collapseSet: state.collapseSet,
            selection: state.selection,
            layout: state.layout,
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            graph: createEdgesAddedGraphDelta([edgeChange]),
        },
    }
}

function applyRemoveEdge(
    state: State,
    command: RemoveEdge,
): { readonly state: State; readonly delta: Delta } {
    const sourceNode = state.graph.nodes[command.source]
    const nextRevision = state.meta.revision + 1

    if (!sourceNode) {
        return {
            state: { ...state, meta: { ...state.meta, revision: nextRevision } },
            delta: { revision: nextRevision, cause: command },
        }
    }

    const edgesRemoved: readonly EdgeChange[] = sourceNode.outgoingEdges
        .filter((edge) => edge.targetId === command.targetId)
        .map((edge) => ({
            source: command.source,
            targetId: command.targetId,
            label: edge.label,
        }))

    if (edgesRemoved.length === 0) {
        return {
            state: { ...state, meta: { ...state.meta, revision: nextRevision } },
            delta: { revision: nextRevision, cause: command },
        }
    }

    const updatedSourceNode = rebuildSourceNodeForRemovedEdge(
        state,
        sourceNode,
        command.targetId,
    )
    const graphMutationDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: updatedSourceNode,
        previousNode: O.some(sourceNode),
    }]
    const graph = applyGraphDeltaToGraph(state.graph, graphMutationDelta)

    return {
        state: {
            graph,
            roots: state.roots,
            collapseSet: state.collapseSet,
            selection: state.selection,
            layout: state.layout,
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            graph: createEdgesRemovedGraphDelta(edgesRemoved),
        },
    }
}

function applyCollapse(
    state: State,
    command: Collapse,
): { readonly state: State; readonly delta: Delta } {
    const alreadyCollapsed = state.collapseSet.has(command.folder)
    const nextRevision = state.meta.revision + 1
    const collapseSet = alreadyCollapsed
        ? state.collapseSet
        : new Set([...state.collapseSet, command.folder])

    return {
        state: {
            graph: state.graph,
            roots: state.roots,
            collapseSet,
            selection: state.selection,
            layout: state.layout,
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            collapseAdded: alreadyCollapsed ? [] : [command.folder],
        },
    }
}

function applyExpand(
    state: State,
    command: Expand,
): { readonly state: State; readonly delta: Delta } {
    const wasCollapsed = state.collapseSet.has(command.folder)
    const nextRevision = state.meta.revision + 1
    const collapseSet = wasCollapsed
        ? new Set([...state.collapseSet].filter((id) => id !== command.folder))
        : state.collapseSet

    return {
        state: {
            graph: state.graph,
            roots: state.roots,
            collapseSet,
            selection: state.selection,
            layout: state.layout,
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            collapseRemoved: wasCollapsed ? [command.folder] : [],
        },
    }
}

function applySelect(
    state: State,
    command: Select,
): { readonly state: State; readonly delta: Delta } {
    const nextRevision = state.meta.revision + 1
    const requested: readonly string[] = command.ids
    const additive = command.additive === true

    if (additive) {
        const seen = new Set<string>(state.selection)
        const newlyAdded: string[] = []
        const ordered: string[] = [...state.selection]
        for (const id of requested) {
            if (!seen.has(id)) {
                seen.add(id)
                ordered.push(id)
                newlyAdded.push(id)
            }
        }
        return {
            state: {
                graph: state.graph,
                roots: state.roots,
                collapseSet: state.collapseSet,
                selection: new Set(ordered),
                layout: state.layout,
                meta: { ...state.meta, revision: nextRevision },
            },
            delta: {
                revision: nextRevision,
                cause: command,
                ...(newlyAdded.length > 0 ? { selectionAdded: newlyAdded } : {}),
            },
        }
    }

    const previousIds = [...state.selection]
    const desiredSeen = new Set<string>()
    const desiredOrdered: string[] = []
    for (const id of requested) {
        if (!desiredSeen.has(id)) {
            desiredSeen.add(id)
            desiredOrdered.push(id)
        }
    }
    const previousSet = new Set(previousIds)
    const selectionAdded = desiredOrdered.filter((id) => !previousSet.has(id))
    const selectionRemoved = previousIds.filter((id) => !desiredSeen.has(id))

    return {
        state: {
            graph: state.graph,
            roots: state.roots,
            collapseSet: state.collapseSet,
            selection: new Set(desiredOrdered),
            layout: state.layout,
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            ...(selectionAdded.length > 0 ? { selectionAdded } : {}),
            ...(selectionRemoved.length > 0 ? { selectionRemoved } : {}),
        },
    }
}

function applyDeselect(
    state: State,
    command: Deselect,
): { readonly state: State; readonly delta: Delta } {
    const nextRevision = state.meta.revision + 1
    const removeSet = new Set(command.ids)
    const removed: string[] = []
    const remaining: string[] = []
    for (const id of state.selection) {
        if (removeSet.has(id)) {
            removed.push(id)
        } else {
            remaining.push(id)
        }
    }

    return {
        state: {
            graph: state.graph,
            roots: state.roots,
            collapseSet: state.collapseSet,
            selection: removed.length === 0 ? state.selection : new Set(remaining),
            layout: state.layout,
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            ...(removed.length > 0 ? { selectionRemoved: removed } : {}),
        },
    }
}

export function emptyState(): State {
    return {
        graph: createEmptyGraph(),
        roots: { loaded: new Set(), folderTree: [] },
        collapseSet: new Set(),
        selection: new Set(),
        layout: { positions: new Map() },
        meta: { schemaVersion: 1, revision: 0 },
    }
}

export function applyCommandWithDelta(
    state: State,
    command: Command,
): { readonly state: State; readonly delta: Delta } {
    switch (command.type) {
        case 'Collapse':
            return applyCollapse(state, command)
        case 'Expand':
            return applyExpand(state, command)
        case 'Select':
            return applySelect(state, command)
        case 'Deselect':
            return applyDeselect(state, command)
        case 'AddNode':
            return applyAddNode(state, command)
        case 'RemoveNode':
            return applyRemoveNode(state, command)
        case 'AddEdge':
            return applyAddEdge(state, command)
        case 'RemoveEdge':
            return applyRemoveEdge(state, command)
        case 'Move':
            return applyMove(state, command)
        case 'UnloadRoot':
            return applyUnloadRoot(state, command)
        case 'LoadRoot':
            throw new Error('LoadRoot requires async disk I/O — use applyCommandAsync instead')
        default:
            throw new Error(`applyCommand not implemented for command type "${(command as Command).type}"`)
    }
}

export function applyCommand(state: State, command: Command): State {
    return applyCommandWithDelta(state, command).state
}

export async function applyCommandAsync(state: State, command: Command): Promise<State> {
    if (command.type === 'LoadRoot') {
        return (await applyLoadRoot(state, command)).state
    }
    return applyCommand(state, command)
}
