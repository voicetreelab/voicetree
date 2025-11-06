import type {Graph, Node} from "@/functional_graph/pure/types.ts";

/**
 * Find the parent node of a given node by searching the graph
 *
 * @param node - The node to find the parent of
 * @param graph - The graph to search
 * @returns The parent node, or undefined if no parent exists (root node)
 */
export function findParentNode(node: Node, graph: Graph): Node | undefined {
    // Search for a node that has this node in its outgoingEdges
    for (const candidateNode of Object.values(graph.nodes)) {
        if (candidateNode.outgoingEdges.includes(node.idAndFilePath)) {
            return candidateNode;
        }
    }
    return undefined;
}