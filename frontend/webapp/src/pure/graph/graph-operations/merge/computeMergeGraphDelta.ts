import type { Graph, GraphDelta, GraphNode, NodeIdAndFilePath } from '@/pure/graph'
import { getIncomingEdgesToSubgraph } from './getIncomingEdgesToSubgraph'
import { createRepresentativeNode, type MergeTitleInfo } from './createRepresentativeNode'
import { redirectEdgeTarget } from './redirectEdgeTarget'
import { findRepresentativeNode } from './findRepresentativeNode'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'

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
 * Outgoing edges to external nodes are preserved on the representative node.
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

    // Get non-context nodes only (context nodes are derived and should not be merged)
    const nonContextNodeIds: readonly NodeIdAndFilePath[] = selectedNodeIds.filter((id) => {
        const node: GraphNode | undefined = graph.nodes[id]
        return node !== undefined && !node.nodeUIMetadata.isContextNode
    })

    if (nonContextNodeIds.length < 2) {
        return []
    }

    const newNodeId: NodeIdAndFilePath = generateMergedNodeId()

    // Get the nodes to merge (already filtered for non-context)
    const nodesToMerge: readonly GraphNode[] = nonContextNodeIds.map(
        (id) => graph.nodes[id] as GraphNode
    )

    // 1. Find the representative node (the one with most reachable nodes inside the subgraph)
    const representativeNodeId: NodeIdAndFilePath | undefined = findRepresentativeNode(nonContextNodeIds, graph)

    // 2. Build merge title info using the representative node's title
    const mergeTitleInfo: MergeTitleInfo | undefined = representativeNodeId !== undefined
        ? {
            representativeTitle: getNodeTitle(graph.nodes[representativeNodeId]),
            otherNodesCount: nodesToMerge.length - 1
        }
        : undefined

    // 3. Create the representative node with the dynamic title
    const representativeNode: GraphNode = createRepresentativeNode(nodesToMerge, newNodeId, mergeTitleInfo)

    // 4. Find all incoming edges from external nodes (only to non-context nodes)
    const incomingEdges: readonly { readonly sourceNodeId: NodeIdAndFilePath; readonly edge: { readonly targetId: NodeIdAndFilePath; readonly label: string } }[] =
        getIncomingEdgesToSubgraph(nonContextNodeIds, graph)

    // 5. Group incoming edges by source node to avoid duplicate updates
    const sourceNodeIdsWithIncomingEdges: readonly NodeIdAndFilePath[] = [
        ...new Set(incomingEdges.map((e) => e.sourceNodeId))
    ]

    // 6. For each external source node, redirect all its edges that point into the subgraph
    const updatedExternalNodes: readonly GraphNode[] = sourceNodeIdsWithIncomingEdges.map((sourceNodeId) => {
        // Use reduce to redirect each edge that points to a non-context node
        const updatedNode: GraphNode = nonContextNodeIds.reduce(
            (node, selectedId) => redirectEdgeTarget(node, selectedId, newNodeId),
            graph.nodes[sourceNodeId]
        )
        return updatedNode
    })

    // 7. Build the GraphDelta
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
        // Finally, delete only the non-context nodes (context nodes are preserved)
        ...nonContextNodeIds.map((nodeId) => ({
            type: 'DeleteNode' as const,
            nodeId
        }))
    ]

    return delta
}
