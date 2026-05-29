import type {FSUpdate, Graph, GraphDelta, GraphNode, NodeIdAndFilePath, UpsertNodeDelta} from '..'
import * as O from 'fp-ts/lib/Option.js'
import {parseMarkdownToGraphNode} from '../markdown-parsing/parse-markdown-to-node'
import {findBestMatchingNode} from '../markdown-parsing/extract-edges'
import {setOutgoingEdges} from '../graph-operations/transforms/graph-edge-operations'
import {filenameToNodeId} from '../markdown-parsing/filename-utils'
import {getBaseName, updateNodeByBaseNameIndexForUpsert, updateUnresolvedLinksIndexForUpsert} from '../graph-operations/indexes/linkResolutionIndexes'

// Position resolution lives at the daemon's apply pipeline
// (resolveInitialPositionsForDelta + applyGraphDeltaToGraph's existing-position
// merge). This pure function just produces a delta with whatever position the
// parser extracted from YAML — None for normal files, Some for legacy YAML
// migrations. Downstream layers fill in or preserve as appropriate.

function healNodeEdges(affectedNodeIds: readonly NodeIdAndFilePath[], currentGraph: Graph, graphWithNewNode: Graph): readonly UpsertNodeDelta[] {
    return affectedNodeIds.flatMap((affectedNodeId): readonly UpsertNodeDelta[] => {
        const affectedNode: GraphNode = currentGraph.nodes[affectedNodeId]

        // Re-resolve the existing edges against the updated graph
        // Pass nodeByBaseName index for O(1) link resolution
        const healedEdges: readonly {
            readonly targetId: string;
            readonly label: string;
        }[] = affectedNode.outgoingEdges.map((edge) => {
            // Try to resolve the raw targetId to an actual node
            const resolvedTargetId: string | undefined = findBestMatchingNode(edge.targetId, graphWithNewNode.nodes, graphWithNewNode.nodeByBaseName)
            return {
                ...edge,
                targetId: resolvedTargetId ?? edge.targetId
            }
        })

        // Only include in delta if edges actually changed
        const edgesChanged: boolean = healedEdges.some((healedEdge, i) => {
            const original: { readonly targetId: string; readonly label: string } = affectedNode.outgoingEdges[i]
            const targetChanged: boolean = healedEdge.targetId !== original.targetId
            // Emit delta when a dangling edge becomes resolved
            const danglingNowResolved: boolean =
                currentGraph.nodes[original.targetId] === undefined &&
                graphWithNewNode.nodes[healedEdge.targetId] !== undefined
            return targetChanged || danglingNowResolved
        })

        if (!edgesChanged) {
            return []
        }

        return [{
            type: 'UpsertNode' as const,
            nodeToUpsert: setOutgoingEdges(affectedNode, healedEdges),
            previousNode: O.some(affectedNode)
        }]
    })
}

/**
 * Adds a node to the graph with progressive edge validation.
 *
 * Pure function: Implements bidirectional edge healing:
 * - Validates outgoing edges from the new node (can now resolve to existing nodes)
 * - Heals incoming edges to the new node (existing nodes with raw links can now resolve)
 *
 * This ensures order-independent graph construction:
 * - Loading [A, B, C] produces same result as [C, B, A]
 * - Bulk load and incremental updates use identical logic
 *
 * Node IDs are absolute paths (normalized with forward slashes).
 *
 * @param fsEvent - Filesystem event with content and absolute path
 * @param currentGraph - Current graph state (used for edge resolution)
 * @returns GraphDelta containing the new node and all healed nodes
 *
 * @example
 * ```typescript
 * // Graph state: { "/project/felix/2.md": { edges: [{ targetId: "1", label: "related" }] } }
 * // Add: /project/felix/1.md
 *
 * const delta = addNodeToGraph(
 *   { absolutePath: "/project/felix/1.md", content: "# One", eventType: "Added" },
 *   currentGraph
 * )
 *
 * // Returns:
 * [
 *   { type: 'UpsertNode', nodeToUpsert: { id: "/project/felix/1.md", ... } },
 *   { type: 'UpsertNode', nodeToUpsert: {
 *       id: "/project/felix/2.md",
 *       edges: [{ targetId: "/project/felix/1.md", label: "related" }]  // HEALED
 *     }
 *   }
 * ]
 * ```
 */
export function addNodeToGraphWithEdgeHealingFromFSEvent(
    fsEvent: FSUpdate,
    currentGraph: Graph
): GraphDelta {
    const nodeId: string = extractNodeIdFromPath(fsEvent.absolutePath)
    const newNode: GraphNode = parseMarkdownToGraphNode(fsEvent.content, nodeId, currentGraph)

    const previousNode: O.Option<GraphNode> = O.fromNullable(currentGraph.nodes[newNode.absoluteFilePathIsID])

    // Use unresolvedLinksIndex for O(1) lookup of nodes with dangling edges to this new node
    const affectedNodeIds: readonly string[] = findNodesWithPotentialEdgesToNode(newNode, currentGraph)

    // Build new nodes record. Position carried by the parsed node (YAML legacy
    // migration only); existing-graph preservation + parent-driven calculation
    // happen downstream in the daemon's apply pipeline.
    const newNodes: Record<string, GraphNode> = {
        ...currentGraph.nodes,
        [newNode.absoluteFilePathIsID]: newNode
    }

    // Create temporary graph with new node for edge re-validation
    // Update indexes to include the new node for O(1) lookups
    const graphWithNewNode: Graph = {
        nodes: newNodes,
        incomingEdgesIndex: currentGraph.incomingEdgesIndex,
        nodeByBaseName: updateNodeByBaseNameIndexForUpsert(currentGraph.nodeByBaseName, newNode, previousNode),
        unresolvedLinksIndex: updateUnresolvedLinksIndexForUpsert(currentGraph.unresolvedLinksIndex, newNode, previousNode, newNodes)
    }


    // Re-validate edges for each affected node (healing)
    // Nodes already have edges with raw targetIds from parseMarkdownToGraphNode
    // We just need to re-resolve those raw targetIds against the updated graph
    // Only nodes with actually changed edges are included
    const healedNodes: readonly UpsertNodeDelta[] = healNodeEdges(affectedNodeIds, currentGraph, graphWithNewNode);

    // Return GraphDelta with new node + all healed nodes
    return [
        {type: 'UpsertNode', nodeToUpsert: newNode, previousNode},
        ...healedNodes
    ]
}

/**
 * Finds all nodes that have edges potentially pointing to the newly added node.
 *
 * Uses unresolvedLinksIndex for O(1) lookup instead of scanning all nodes.
 *
 * @param newNode - The newly added node
 * @param currentGraph - Current graph state
 * @returns Array of node IDs that need edge re-validation
 *
 * @example
 * ```typescript
 * // New node: "ctx-nodes/VT/foo.md"
 * // unresolvedLinksIndex: { "foo": ["/project/other.md"] }
 * // => Returns ["/project/other.md"]
 * ```
 */
function findNodesWithPotentialEdgesToNode(
    newNode: GraphNode,
    currentGraph: Graph
): readonly NodeIdAndFilePath[] {
    const newNodeBasename: string = getBaseName(newNode.absoluteFilePathIsID)
    // O(1) lookup using unresolvedLinksIndex
    return currentGraph.unresolvedLinksIndex.get(newNodeBasename) ?? []
}

/**
 * Extract node ID from file path using the absolute path.
 *
 * Node IDs are now absolute paths (normalized with forward slashes).
 * This simplifies the architecture by removing the need for a project/watched directory base.
 *
 * @param filePath - Absolute path to the file (e.g., "/path/to/project/subfolder/MyNote.md")
 * @returns GraphNode ID as normalized absolute path (e.g., "/path/to/project/subfolder/MyNote.md")
 */
function extractNodeIdFromPath(filePath: string): NodeIdAndFilePath {
    // Normalize path separators to forward slashes for cross-platform consistency
    return filenameToNodeId(filePath)
}
