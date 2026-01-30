import type { Graph, GraphDelta, GraphNode, NodeIdAndFilePath } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import { getIncomingEdgesToSubgraph } from './getIncomingEdgesToSubgraph'
import { createRepresentativeNode, type MergeTitleInfo } from './createRepresentativeNode'
import { redirectEdgeTarget } from './redirectEdgeTarget'
import { findRepresentativeNode } from './findRepresentativeNode'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'

/**
 * Generates a unique ID for a merged node based on timestamp and random suffix.
 * Node IDs are absolute paths to simplify path handling.
 * @param writePath - Absolute path to the write directory (where merged nodes are created)
 */
function generateMergedNodeId(writePath: string): NodeIdAndFilePath {
    const timestamp: number = Date.now()
    const randomSuffix: string = Math.random().toString(36).substring(2, 5)
    const filename: string = `merged_${timestamp}_${randomSuffix}.md`
    const separator: string = writePath.endsWith('/') ? '' : '/'
    return `${writePath}${separator}${filename}`
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
 * @param writePath - Absolute path to the write directory (where merged nodes are created)
 * @returns GraphDelta containing UpsertNode and DeleteNode actions
 */
export function computeMergeGraphDelta(
    selectedNodeIds: readonly NodeIdAndFilePath[],
    graph: Graph,
    writePath: string
): GraphDelta {
    if (selectedNodeIds.length < 2) {
        return []
    }

    // Separate context nodes from regular nodes
    const validSelectedNodeIds: readonly NodeIdAndFilePath[] = selectedNodeIds.filter((id) => {
        return graph.nodes[id] !== undefined
    })

    const nonContextNodeIds: readonly NodeIdAndFilePath[] = validSelectedNodeIds.filter((id) => {
        const node: GraphNode = graph.nodes[id] as GraphNode
        return !node.nodeUIMetadata.isContextNode
    })

    const contextNodeIds: readonly NodeIdAndFilePath[] = validSelectedNodeIds.filter((id) => {
        const node: GraphNode = graph.nodes[id] as GraphNode
        return node.nodeUIMetadata.isContextNode === true
    })

    // Context nodes are always deleted when selected (they're derived/temporary)
    const contextNodeDeletions: GraphDelta = contextNodeIds.map((nodeId) => ({
        type: 'DeleteNode' as const,
        nodeId,
        deletedNode: O.fromNullable(graph.nodes[nodeId])
    }))

    // Need at least 2 non-context nodes to create a merge
    if (nonContextNodeIds.length < 2) {
        return contextNodeDeletions
    }

    const newNodeId: NodeIdAndFilePath = generateMergedNodeId(writePath)

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
    const updatedExternalNodesWithPrevious: readonly { readonly updatedNode: GraphNode; readonly previousNode: O.Option<GraphNode> }[] = sourceNodeIdsWithIncomingEdges.map((sourceNodeId) => {
        const previousNodeRaw: GraphNode = graph.nodes[sourceNodeId]
        // Use reduce to redirect each edge that points to a non-context node
        const updatedNode: GraphNode = nonContextNodeIds.reduce(
            (node, selectedId) => redirectEdgeTarget(node, selectedId, newNodeId),
            previousNodeRaw
        )
        return { updatedNode, previousNode: O.some(previousNodeRaw) }
    })

    // 7. Build the GraphDelta
    const delta: GraphDelta = [
        // First, upsert the new representative node
        {
            type: 'UpsertNode',
            nodeToUpsert: representativeNode,
            previousNode: O.none  // New node - no previous state
        },
        // Then, upsert all updated external nodes with redirected edges
        ...updatedExternalNodesWithPrevious.map(({ updatedNode, previousNode }) => ({
            type: 'UpsertNode' as const,
            nodeToUpsert: updatedNode,
            previousNode  // Capture previous state for undo
        })),
        // Delete non-context nodes (their content is merged into representative)
        ...nonContextNodeIds.map((nodeId) => ({
            type: 'DeleteNode' as const,
            nodeId,
            deletedNode: O.some(graph.nodes[nodeId])  // Capture for undo support
        })),
        // Delete context nodes (not merged, but removed from graph)
        ...contextNodeDeletions
    ]

    return delta
}
