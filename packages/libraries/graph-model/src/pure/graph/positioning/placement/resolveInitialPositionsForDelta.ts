import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphDelta, GraphNode, UpsertNodeDelta } from '../..'
import { buildSpatialIndexFromGraph } from './spatialAdapters'
import { resolveInitialPositionForNewNode } from './calculateInitialPosition'
import type { SpatialIndex } from '../graphLayoutPrimitives'

/**
 * Daemon-side position resolution for an incoming graph delta.
 *
 * Pure function: walks the delta and, for every UpsertNode that is BOTH new
 * to the graph (previousNode = None) AND lacks a position, computes one from
 * the node's outgoing parent edge against the supplied graph. Entries that
 * already carry a position (e.g. legacy YAML migration, explicit caller
 * position, UI drag) are passed through untouched, as are updates to
 * existing nodes (those keep their saved position via the merge in
 * applyGraphDeltaToGraph).
 *
 * Authoring paths (vt graph create, spawn_agent, etc.) now produce position-
 * less deltas and rely on this resolver — keeping position computation out
 * of authoring code per CLAUDE.md functional-design preference.
 */
export interface ResolveInitialPositionsResult {
    readonly delta: GraphDelta
    readonly anyResolved: boolean
}

export function resolveInitialPositionsForDelta(graph: Graph, delta: GraphDelta): ResolveInitialPositionsResult {
    const needsResolution: boolean = delta.some(d =>
        d.type === 'UpsertNode'
        && O.isNone(d.previousNode)
        && O.isNone(d.nodeToUpsert.nodeUIMetadata.position)
    )
    if (!needsResolution) return { delta, anyResolved: false }

    let workingGraph: Graph = graph
    let anyResolved: boolean = false

    const resolvedDelta: GraphDelta = delta.map((d): GraphDelta[number] => {
        if (d.type !== 'UpsertNode') return d
        if (O.isSome(d.previousNode)) return d
        if (O.isSome(d.nodeToUpsert.nodeUIMetadata.position)) {
            workingGraph = { ...workingGraph, nodes: { ...workingGraph.nodes, [d.nodeToUpsert.absoluteFilePathIsID]: d.nodeToUpsert } }
            return d
        }

        const spatialIndex: SpatialIndex = buildSpatialIndexFromGraph(workingGraph)
        const resolved: O.Option<{ readonly x: number; readonly y: number }> =
            resolveInitialPositionForNewNode(workingGraph, d.nodeToUpsert, spatialIndex)
        if (O.isNone(resolved)) return d

        anyResolved = true
        const positionedNode: GraphNode = {
            ...d.nodeToUpsert,
            nodeUIMetadata: { ...d.nodeToUpsert.nodeUIMetadata, position: resolved }
        }
        workingGraph = { ...workingGraph, nodes: { ...workingGraph.nodes, [positionedNode.absoluteFilePathIsID]: positionedNode } }
        const resolvedEntry: UpsertNodeDelta = { ...d, nodeToUpsert: positionedNode }
        return resolvedEntry
    })

    return { delta: resolvedDelta, anyResolved }
}
