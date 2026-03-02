import type { Graph, NodeIdAndFilePath } from '@/pure/graph'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'
import { deleteNodeSimple } from './removeNodeMaintainingTransitiveEdges'

/**
 * Removes all context nodes from a graph.
 * Simply deletes each context node and cleans up parent edges — no edge healing.
 *
 * Pure function: same input -> same output, no side effects.
 */
export function removeContextNodes(graph: Graph): Graph {
    const contextNodeIds: readonly NodeIdAndFilePath[] = Object.keys(graph.nodes)
        .filter(id => graph.nodes[id].nodeUIMetadata.isContextNode === true)

    return contextNodeIds.reduce(
        (g, id) => applyGraphDeltaToGraph(g, deleteNodeSimple(g, id)),
        graph
    )
}
