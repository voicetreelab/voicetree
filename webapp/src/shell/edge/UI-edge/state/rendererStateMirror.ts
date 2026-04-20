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
import type { Graph, GraphDelta, NodeIdAndFilePath, Position } from '@vt/graph-model'

import {
    emptyState,
    project,
    type ElementSpec,
    type State,
} from '@vt/graph-state'

import { getCollapseSet } from '@vt/graph-state/state/collapseSetStore'
import { getSelection } from '@vt/graph-state/state/selectionStore'

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

function buildStateFromMirror(): State {
    const base: State = emptyState()
    return {
        ...base,
        graph: mirror.graph,
        collapseSet: getCollapseSet(),
        selection: getSelection(),
        layout: {
            ...base.layout,
            positions: mirror.positions,
        },
        meta: { ...base.meta, revision: mirror.revision },
    }
}

export function applyDeltaToRendererStateMirror(delta: GraphDelta): void {
    if (delta.length === 0) return
    mirror.graph = applyGraphDeltaToGraph(mirror.graph, delta)
    updatePositionsFromDelta(delta)
    mirror.revision += 1
}

export function resetRendererStateMirror(): void {
    mirror.graph = createEmptyGraph()
    mirror.revision = 0
    mirror.positions = new Map()
}

export function projectRendererState(): ElementSpec {
    return project(buildStateFromMirror())
}

export function projectDelta(delta: GraphDelta): ElementSpec {
    applyDeltaToRendererStateMirror(delta)
    return projectRendererState()
}
