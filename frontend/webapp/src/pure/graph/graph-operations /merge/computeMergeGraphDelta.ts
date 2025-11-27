import type { Graph, GraphDelta, GraphNode, NodeIdAndFilePath } from '@/pure/graph'
import { getIncomingEdgesToSubgraph } from './getIncomingEdgesToSubgraph'
import { createRepresentativeNode } from './createRepresentativeNode'
import { redirectEdgeTarget } from './redirectEdgeTarget'

/**
 * Generates a unique ID for a merged node based on timestamp and random suffix.
 */
function generateMergedNodeId(): NodeIdAndFilePath {
    const timestamp: number = Date.now()
    const randomSuffix: string = Math.random().toString(36).substring(2, 5)
    return `VT/merged_${timestamp}_${randomSuffix}.md`
}

/**
 * Computes the GraphDelta for merging selected nodes into a single representative node.
 *
 * This is a destructive merge operation that:
 * 1. Creates a new representative node at the centroid of merged nodes
 * 2. Redirects all incoming edges (from external nodes) to the representative
 * 3. Deletes all original nodes in the selection
 *
 * Internal edges (between selected nodes) are discarded.
 * Outgoing edges from the subgraph are discarded.
 *
 * @param selectedNodeIds - Array of node IDs to merge (must have at least 2)
 * @param graph - The current graph state
 * @returns GraphDelta containing UpsertNode and DeleteNode actions
 */
export function computeMergeGraphDelta(
    selectedNodeIds: readonly NodeIdAndFilePath[],
    graph: Graph
): GraphDelta {
    if (selectedNodeIds.length < 2) {
        return []
    }

    const newNodeId: NodeIdAndFilePath = generateMergedNodeId()

    // Get the nodes to merge
    const nodesToMerge: readonly GraphNode[] = selectedNodeIds
        .map((id) => graph.nodes[id])
        .filter((node): node is GraphNode => node !== undefined)

    if (nodesToMerge.length < 2) {
        return []
    }

    // 1. Create the representative node
    const representativeNode: GraphNode = createRepresentativeNode(nodesToMerge, newNodeId)

    // 2. Find all incoming edges from external nodes
    const incomingEdges: readonly { readonly sourceNodeId: NodeIdAndFilePath; readonly edge: { readonly targetId: NodeIdAndFilePath; readonly label: string } }[] =
        getIncomingEdgesToSubgraph(selectedNodeIds, graph)

    // 3. Group incoming edges by source node to avoid duplicate updates
    const sourceNodeIdsWithIncomingEdges: readonly NodeIdAndFilePath[] = [
        ...new Set(incomingEdges.map((e) => e.sourceNodeId))
    ]

    // 4. For each external source node, redirect all its edges that point into the subgraph
    const updatedExternalNodes: readonly GraphNode[] = sourceNodeIdsWithIncomingEdges.map((sourceNodeId) => {
        // Use reduce to redirect each edge that points to a selected node
        const updatedNode: GraphNode = selectedNodeIds.reduce(
            (node, selectedId) => redirectEdgeTarget(node, selectedId, newNodeId),
            graph.nodes[sourceNodeId]
        )
        return updatedNode
    })

    // 5. Build the GraphDelta
    const delta: GraphDelta = [
        // First, upsert the new representative node
        {
            type: 'UpsertNode',
            nodeToUpsert: representativeNode
        },
        // Then, upsert all updated external nodes with redirected edges
        ...updatedExternalNodes.map((node) => ({
            type: 'UpsertNode' as const,
            nodeToUpsert: node
        })),
        // Finally, delete all the original selected nodes
        ...selectedNodeIds.map((nodeId) => ({
            type: 'DeleteNode' as const,
            nodeId
        }))
    ]

    return delta
}
