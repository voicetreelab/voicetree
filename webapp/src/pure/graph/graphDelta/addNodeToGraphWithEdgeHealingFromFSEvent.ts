import type {FSUpdate, Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position, UpsertNodeDelta} from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import {parseMarkdownToGraphNode} from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
import {findBestMatchingNode} from '@/pure/graph/markdown-parsing/extract-edges'
import {setOutgoingEdges} from '@/pure/graph/graph-operations/graph-edge-operations'
import {filenameToNodeId} from '@/pure/graph/markdown-parsing/filename-utils'
import {calculateCollisionAwareChildPosition} from "@/pure/graph/positioning/calculateInitialPosition";
import {extractAllObstaclesFromGraph} from "@/pure/graph/positioning/extractObstaclesFromGraph";
import {getBaseName, updateNodeByBaseNameIndexForUpsert, updateUnresolvedLinksIndexForUpsert} from '@/pure/graph/graph-operations/linkResolutionIndexes'

/**
 * Resolve position for a node based on priority:
 * 1. previousNode's Graph position (most current, synced from UI)
 * 2. parsedNode's YAML position (initial seed for new nodes)
 * 3. calculated from first parent (if any parent exists)
 * 4. none (defaults to 0,0 in UI)
 */
function resolveNodePosition(
    parsedNode: GraphNode,
    previousNode: O.Option<GraphNode>,
    affectedNodeIds: readonly string[],
    currentGraph: Graph
): O.Option<Position> {
    // Priority 1: Use previous node's position from Graph (most current, synced from UI)
    if (O.isSome(previousNode) && O.isSome(previousNode.value.nodeUIMetadata.position)) {
        return previousNode.value.nodeUIMetadata.position
    }

    // Priority 2: Use YAML position if present
    if (O.isSome(parsedNode.nodeUIMetadata.position)) {
        return parsedNode.nodeUIMetadata.position
    }

    // Priority 3: Calculate from first parent with collision avoidance
    // Uses graph-derived obstacles (approximate dimensions) since cytoscape isn't available in pure context
    if (affectedNodeIds.length >= 1) {
        const parentId: NodeIdAndFilePath = affectedNodeIds[0]
        const parent: GraphNode = currentGraph.nodes[parentId]
        if (O.isSome(parent.nodeUIMetadata.position)) {
            const obstacles: readonly import("@/pure/graph/positioning/findBestPosition").Obstacle[] = extractAllObstaclesFromGraph(parentId, currentGraph)
            return O.some(calculateCollisionAwareChildPosition(parent.nodeUIMetadata.position.value, currentGraph, parentId, obstacles, 200))
        }
        return O.none
    }

    // Priority 4: No position (defaults to 0,0 in UI layer)
    return O.none
}

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
 * // Graph state: { "/vault/felix/2.md": { edges: [{ targetId: "1", label: "related" }] } }
 * // Add: /vault/felix/1.md
 *
 * const delta = addNodeToGraph(
 *   { absolutePath: "/vault/felix/1.md", content: "# One", eventType: "Added" },
 *   currentGraph
 * )
 *
 * // Returns:
 * [
 *   { type: 'UpsertNode', nodeToUpsert: { id: "/vault/felix/1.md", ... } },
 *   { type: 'UpsertNode', nodeToUpsert: {
 *       id: "/vault/felix/2.md",
 *       edges: [{ targetId: "/vault/felix/1.md", label: "related" }]  // HEALED
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
    const parsedNode: GraphNode = parseMarkdownToGraphNode(fsEvent.content, nodeId, currentGraph)

    // Check if this is a new node or an update to an existing node
    //console.log(`nodeId: ${nodeId}, relativeFilePathIsID: ${parsedNode.absoluteFilePathIsID}`)
    const previousNode: O.Option<GraphNode> = O.fromNullable(currentGraph.nodes[parsedNode.absoluteFilePathIsID])

    // Use unresolvedLinksIndex for O(1) lookup of nodes with dangling edges to this new node
    const affectedNodeIds: readonly string[] = findNodesWithPotentialEdgesToNode(parsedNode, currentGraph)

    // Position resolution priority:
    // 1. previousNode's Graph position (most current, synced from UI)
    // 2. newNode's YAML position (initial seed for new nodes)
    // 3. calculated from first parent (if any parent exists)
    // 4. none (defaults to 0,0 in UI)
    const resolvedPosition: O.Option<Position> = resolveNodePosition(parsedNode, previousNode, affectedNodeIds, currentGraph)

    const newNode: GraphNode = resolvedPosition !== parsedNode.nodeUIMetadata.position
        ? { ...parsedNode, nodeUIMetadata: { ...parsedNode.nodeUIMetadata, position: resolvedPosition } }
        : parsedNode

    // Build new nodes record
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
 * // unresolvedLinksIndex: { "foo": ["/vault/other.md"] }
 * // => Returns ["/vault/other.md"]
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
 * This simplifies the architecture by removing the need for a vault/watched directory base.
 *
 * @param filePath - Absolute path to the file (e.g., "/path/to/vault/subfolder/MyNote.md")
 * @returns GraphNode ID as normalized absolute path (e.g., "/path/to/vault/subfolder/MyNote.md")
 */
function extractNodeIdFromPath(filePath: string): NodeIdAndFilePath {
    // Normalize path separators to forward slashes for cross-platform consistency
    return filenameToNodeId(filePath)
}
