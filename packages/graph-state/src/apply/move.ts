import * as O from 'fp-ts/lib/Option.js'

import { applyGraphDeltaToGraph, type GraphDelta } from '@vt/graph-model'

import type { Delta, Move, State } from '../contract'

export function applyMove(
    state: State,
    command: Move,
): { readonly state: State; readonly delta: Delta } {
    const nextRevision = state.meta.revision + 1
    const existingNode = state.graph.nodes[command.id]

    if (!existingNode) {
        return {
            state: { ...state, meta: { ...state.meta, revision: nextRevision } },
            delta: { revision: nextRevision, cause: command },
        }
    }

    const updatedNode = {
        ...existingNode,
        nodeUIMetadata: {
            ...existingNode.nodeUIMetadata,
            position: O.some(command.to),
        },
    }
    const graphDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: updatedNode,
        previousNode: O.some(existingNode),
    }]
    const graph = applyGraphDeltaToGraph(state.graph, graphDelta)

    const positions = new Map(state.layout.positions)
    positions.set(command.id, command.to)

    return {
        state: {
            ...state,
            graph,
            layout: { ...state.layout, positions },
            meta: { ...state.meta, revision: nextRevision },
        },
        delta: {
            revision: nextRevision,
            cause: command,
            positionsMoved: new Map([[command.id, command.to]]),
        },
    }
}
