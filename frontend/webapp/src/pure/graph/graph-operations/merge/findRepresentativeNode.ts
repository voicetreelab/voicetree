import type { Graph, NodeIdAndFilePath } from '@/pure/graph'

/**
 * Counts the number of reachable nodes (descendants) from this node within the subgraph.
 * Uses BFS following outgoing edges forward.
 * Only counts descendants that are inside the subgraph.
 */
function countReachableNodesInSubgraph(
    nodeId: NodeIdAndFilePath,
    graph: Graph,
    subgraphNodeIds: ReadonlySet<NodeIdAndFilePath>
): number {
    const node = graph.nodes[nodeId]
    if (!node) return 0

    // BFS to find all reachable nodes within the subgraph
    const visited: Set<NodeIdAndFilePath> = new Set()
    const queue: NodeIdAndFilePath[] = [nodeId]
    visited.add(nodeId)

    while (queue.length > 0) {
        const current = queue.shift()!
        const currentNode = graph.nodes[current]
        if (!currentNode) continue

        for (const edge of currentNode.outgoingEdges) {
            // Only follow edges to nodes within the subgraph
            if (!subgraphNodeIds.has(edge.targetId)) continue

            if (!visited.has(edge.targetId)) {
                visited.add(edge.targetId)
                queue.push(edge.targetId)
            }
        }
    }

    // Count reachable nodes (excluding the node itself)
    return visited.size - 1
}

/**
 * Finds the node inside the subgraph with the most reachable nodes (descendants)
 * to use as the representative for a merged node.
 *
 * The node with the most reachable nodes is the "root" or most encompassing node
 * in the hierarchy, making it a good representative for the merged group.
 *
 * @param subgraphNodeIds - The node IDs being merged
 * @param graph - The full graph
 * @returns The node ID of the representative node, or undefined if subgraph is empty
 */
export function findRepresentativeNode(
    subgraphNodeIds: readonly NodeIdAndFilePath[],
    graph: Graph
): NodeIdAndFilePath | undefined {
    if (subgraphNodeIds.length === 0) {
        return undefined
    }

    const subgraphSet: ReadonlySet<NodeIdAndFilePath> = new Set(subgraphNodeIds)

    // For each node in the subgraph, count its reachable nodes within the subgraph
    const nodeWithReachableCount: readonly { nodeId: NodeIdAndFilePath; reachableCount: number }[] =
        subgraphNodeIds
            .filter(nodeId => graph.nodes[nodeId] !== undefined)
            .map(nodeId => ({
                nodeId,
                reachableCount: countReachableNodesInSubgraph(nodeId, graph, subgraphSet)
            }))

    if (nodeWithReachableCount.length === 0) {
        return undefined
    }

    // Sort by reachable count (descending), then by nodeId (ascending for stability)
    const sorted = [...nodeWithReachableCount].sort((a, b) => {
        if (b.reachableCount !== a.reachableCount) {
            return b.reachableCount - a.reachableCount
        }
        return a.nodeId.localeCompare(b.nodeId)
    })

    return sorted[0].nodeId
}
