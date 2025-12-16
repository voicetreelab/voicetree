import type { Graph, NodeIdAndFilePath } from '@/pure/graph'
import { applyGraphDeltaToGraph } from '@/pure/graph/graphDelta/applyGraphDeltaToGraph'
import { deleteNodeMaintainingTransitiveEdges } from './removeNodeMaintainingTransitiveEdges'

/**
 * Removes all context nodes from a graph, preserving transitive connectivity.
 *
 * For each context node, redirects incoming edges to its children:
 * A -> ContextNode -> B becomes A -> B
 *
 * Handles chained context nodes transitively.
 *
 * Pure function: same input -> same output, no side effects.
 *
 * @param graph - The graph to transform
 * @returns New graph with all context nodes removed and edges preserved
 *
 * @example
 * // Given: A -> ContextNode -> B -> Ctx2 -> C
 * // Result: A -> B -> C
 */
export function removeContextNodes(graph: Graph): Graph {
    const contextNodeIds: readonly NodeIdAndFilePath[] = Object.keys(graph.nodes)
        .filter(id => graph.nodes[id].nodeUIMetadata.isContextNode === true)

    return contextNodeIds.reduce(
        (g, id) => applyGraphDeltaToGraph(g, deleteNodeMaintainingTransitiveEdges(g, id)),
        graph
    )
}
