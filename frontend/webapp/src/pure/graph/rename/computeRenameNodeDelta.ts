import type { Graph, GraphDelta, GraphNode, NodeIdAndFilePath, UpsertNodeDelta } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import { redirectEdgeTarget } from '@/pure/graph/graph-operations/merge/redirectEdgeTarget'
import { getIncomingEdgesToSubgraph } from '@/pure/graph/graph-operations/merge/getIncomingEdgesToSubgraph'
import { replaceWikilinkPlaceholders } from './replaceWikilinkPlaceholders'

/**
 * Computes a GraphDelta for renaming a node.
 *
 * This function creates:
 * 1. An UpsertNode delta for the renamed node (newId, previousNode has oldId)
 * 2. UpsertNode deltas for each node with an incoming edge (updated edge + content)
 *
 * The rename is signaled by ID mismatch: previousNode.relativeFilePathIsID !== nodeToUpsert.relativeFilePathIsID
 * Delta application layers will detect this pattern and handle the rename appropriately.
 *
 * @param oldNodeId - The current node ID to rename from
 * @param newNodeId - The new node ID to rename to
 * @param graph - The current graph state
 * @returns GraphDelta containing all necessary UpsertNode deltas
 */
export function computeRenameNodeDelta(
    oldNodeId: NodeIdAndFilePath,
    newNodeId: NodeIdAndFilePath,
    graph: Graph
): GraphDelta {
    const oldNode: GraphNode | undefined = graph.nodes[oldNodeId]
    if (oldNode === undefined) {
        return []
    }

    // 1. Create the renamed node delta
    const renamedNode: GraphNode = {
        ...oldNode,
        relativeFilePathIsID: newNodeId
    }

    const renamedNodeDelta: UpsertNodeDelta = {
        type: 'UpsertNode',
        nodeToUpsert: renamedNode,
        previousNode: O.some(oldNode)
    }

    // 2. Find all nodes with incoming edges to the renamed node
    const incomingEdges: readonly { readonly sourceNodeId: NodeIdAndFilePath; readonly edge: import('@/pure/graph').Edge }[] = getIncomingEdgesToSubgraph([oldNodeId], graph)

    // 3. Create deltas for each node with incoming edges
    // Group by source node ID to handle multiple edges from same source
    const sourceNodeIds: ReadonlySet<NodeIdAndFilePath> = new Set(
        incomingEdges.map(e => e.sourceNodeId)
    )

    const incomingNodeDeltas: readonly UpsertNodeDelta[] = Array.from(sourceNodeIds).map(
        (sourceNodeId: NodeIdAndFilePath): UpsertNodeDelta => {
            const sourceNode: GraphNode = graph.nodes[sourceNodeId]

            // Update edge targets using redirectEdgeTarget
            const nodeWithUpdatedEdges: GraphNode = redirectEdgeTarget(
                sourceNode,
                oldNodeId,
                newNodeId
            )

            // Update content placeholders using replaceWikilinkPlaceholders
            const updatedContent: string = replaceWikilinkPlaceholders(
                nodeWithUpdatedEdges.contentWithoutYamlOrLinks,
                oldNodeId,
                newNodeId
            )

            const updatedNode: GraphNode = {
                ...nodeWithUpdatedEdges,
                contentWithoutYamlOrLinks: updatedContent
            }

            return {
                type: 'UpsertNode',
                nodeToUpsert: updatedNode,
                previousNode: O.some(sourceNode)
            }
        }
    )

    return [renamedNodeDelta, ...incomingNodeDeltas]
}
