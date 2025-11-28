import type { Graph, NodeIdAndFilePath } from '@/pure/graph'

/**
 * Counts the number of ancestors (nodes that can reach this node) within the subgraph.
 * Uses BFS on the reversed graph (following edges backward).
 * Only counts ancestors that are inside the subgraph.
 */
function countAncestorsInSubgraph(
    nodeId: NodeIdAndFilePath,
    graph: Graph,
    subgraphNodeIds: ReadonlySet<NodeIdAndFilePath>
): number {
    // Build reverse adjacency map for subgraph nodes only
    const reverseEdges: Map<NodeIdAndFilePath, NodeIdAndFilePath[]> = new Map()

    for (const [sourceId, node] of Object.entries(graph.nodes)) {
        // Only consider edges from nodes in the subgraph
        if (!subgraphNodeIds.has(sourceId)) continue

        for (const edge of node.outgoingEdges) {
            // Only consider edges to nodes in the subgraph
            if (!subgraphNodeIds.has(edge.targetId)) continue

            const existing = reverseEdges.get(edge.targetId) ?? []
            reverseEdges.set(edge.targetId, [...existing, sourceId])
        }
    }

    // BFS to find all ancestors within the subgraph
    const visited: Set<NodeIdAndFilePath> = new Set()
    const queue: NodeIdAndFilePath[] = [nodeId]
    visited.add(nodeId)

    while (queue.length > 0) {
        const current = queue.shift()!
        const parents = reverseEdges.get(current) ?? []

        for (const parent of parents) {
            if (!visited.has(parent)) {
                visited.add(parent)
                queue.push(parent)
            }
        }
    }

    // Count ancestors (excluding the node itself)
    return visited.size - 1
}

/**
 * Finds the node inside the subgraph with the most ancestors (within the subgraph)
 * to use as the representative name for a merged node.
 *
 * The node with the most ancestors is typically the "deepest" or most specific node
 * in the hierarchy, making it a good representative for the merged group.
 *
 * @param subgraphNodeIds - The node IDs being merged
 * @param graph - The full graph
 * @returns The node ID of the representative node, or undefined if subgraph is empty
 */
export function findRepresentativeParent(
    subgraphNodeIds: readonly NodeIdAndFilePath[],
    graph: Graph
): NodeIdAndFilePath | undefined {
    if (subgraphNodeIds.length === 0) {
        return undefined
    }

    const subgraphSet: ReadonlySet<NodeIdAndFilePath> = new Set(subgraphNodeIds)

    // For each node in the subgraph, count its ancestors within the subgraph
    const nodeWithAncestorCount: readonly { nodeId: NodeIdAndFilePath; ancestorCount: number }[] =
        subgraphNodeIds
            .filter(nodeId => graph.nodes[nodeId] !== undefined)
            .map(nodeId => ({
                nodeId,
                ancestorCount: countAncestorsInSubgraph(nodeId, graph, subgraphSet)
            }))

    if (nodeWithAncestorCount.length === 0) {
        return undefined
    }

    // Sort by ancestor count (descending), then by nodeId (ascending for stability)
    const sorted = [...nodeWithAncestorCount].sort((a, b) => {
        if (b.ancestorCount !== a.ancestorCount) {
            return b.ancestorCount - a.ancestorCount
        }
        return a.nodeId.localeCompare(b.nodeId)
    })

    return sorted[0].nodeId
}
