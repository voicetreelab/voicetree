import type {Graph, GraphNode} from "@/pure/graph";

/**
 * Find the parent node of a given node by searching the graph
 *
 * @param node - The node to find the parent of
 * @param graph - The graph to search
 * @returns The parent node, or undefined if no parent exists (root node)
 */
export function getIncomingNodes(node: GraphNode, graph: Graph): readonly GraphNode[] {
    // Search for a node that has this node in its outgoingEdges

    // assumes graph is tree, just returns first incoming edge
    return Object.values(graph.nodes).filter((candidateNode) =>
        candidateNode.outgoingEdges.some(e => e.targetId === node.relativeFilePathIsID)
    );

    // TODO MAKE THIS O(1) with a type IncomingEdgesIndex = Map<NodeId, readonly NodeId[]> on Graph
}