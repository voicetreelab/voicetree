import type {Graph, GraphNode, NodeIdAndFilePath} from "@/pure/graph";

/**
 * Find all nodes that have outgoing edges to the given node (its incomers/parents).
 *
 * Uses the graph's incomingEdgesIndex for O(1) lookup instead of scanning all nodes.
 *
 * @param node - The node to find incomers for
 * @param graph - The graph to search
 * @returns Array of nodes that have edges pointing to this node
 */
export function getIncomingNodes(node: GraphNode, graph: Graph): readonly GraphNode[] {
    const incomerIds: readonly NodeIdAndFilePath[] = graph.incomingEdgesIndex.get(node.absoluteFilePathIsID) ?? []
    return incomerIds
        .map(id => graph.nodes[id])
        .filter((n): n is GraphNode => n !== undefined)
}