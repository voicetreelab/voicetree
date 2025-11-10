import type {Graph, GraphNode} from "@/functional_graph/pure/types.ts";

/**
 * Find the parent node of a given node by searching the graph
 *
 * @param node - The node to find the parent of
 * @param graph - The graph to search
 * @returns The parent node, or undefined if no parent exists (root node)
 */
export function findFirstParentNode(node: GraphNode, graph: Graph): GraphNode | undefined {
    // Search for a node that has this node in its outgoingEdges

    // assumes graph is tree, just returns first incoming edge
    return Object.values(graph.nodes).find((candidateNode) =>
        candidateNode.outgoingEdges.includes(node.relativeFilePathIsID)
    );

    // TODO MAKE THIS O(1) with a type IncomingEdgesIndex = Map<NodeId, readonly NodeId[]> on Graph
}