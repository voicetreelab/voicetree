import type {FSUpdate, Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position, UpsertNodeDelta} from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'
import path from 'path'
import {parseMarkdownToGraphNode} from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
import {linkMatchScore, findBestMatchingNode} from '@/pure/graph/markdown-parsing/extract-edges'
import {setOutgoingEdges} from '@/pure/graph/graph-operations/graph-edge-operations'
import {filenameToNodeId} from '@/pure/graph/markdown-parsing/filename-utils'
import {calculateInitialPositionForChild} from "@/pure/graph/positioning/calculateInitialPosition";

interface HealedNodeWithPrevious { //todo unnecessary
    readonly healedNode: GraphNode
    readonly previousNode: O.Option<GraphNode>
}

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

    // Priority 3: Calculate from first parent if any exists
    if (affectedNodeIds.length >= 1) {
        const parent: GraphNode = currentGraph.nodes[affectedNodeIds[0]]
        return calculateInitialPositionForChild(parent, currentGraph)
    }

    // Priority 4: No position (defaults to 0,0 in UI layer)
    return O.none
}

function healNodeEdges(affectedNodeIds: readonly NodeIdAndFilePath[], currentGraph: Graph, graphWithNewNode: Graph): readonly HealedNodeWithPrevious[] {
    const healedNodes: readonly HealedNodeWithPrevious[] = affectedNodeIds.map((affectedNodeId) => {
        const affectedNode: GraphNode = currentGraph.nodes[affectedNodeId]

        // Re-resolve the existing edges against the updated graph
        const healedEdges: readonly {
            readonly targetId: string;
            readonly label: string;
        }[] = affectedNode.outgoingEdges.map((edge) => {
            // Try to resolve the raw targetId to an actual node using linkMatchScore-based matching
            const resolvedTargetId: string | undefined = findBestMatchingNode(edge.targetId, graphWithNewNode.nodes)
            return {
                ...edge,
                targetId: resolvedTargetId ?? edge.targetId
            }
        })

        return {
            healedNode: setOutgoingEdges(affectedNode, healedEdges),
            previousNode: O.some(affectedNode)  // Capture previous state before edge healing
        } // todo do we really need to return here? can we not in whoever calls this function return the old as well?
    })
    return healedNodes;
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
 * @param fsEvent - Filesystem event with content and path
 * @param vaultPath - Absolute path to vault directory
 * @param currentGraph - Current graph state (used for edge resolution)
 * @returns GraphDelta containing the new node and all healed nodes
 *
 * @example
 * ```typescript
 * // Graph state: { "felix/2": { edges: [{ targetId: "1", label: "related" }] } }
 * // Add: felix/1.md
 *
 * const delta = addNodeToGraph(
 *   { absolutePath: "/vault/felix/1.md", content: "# One", eventType: "Added" },
 *   "/vault",
 *   currentGraph
 * )
 *
 * // Returns:
 * [
 *   { type: 'UpsertNode', nodeToUpsert: { id: "felix/1", ... } },
 *   { type: 'UpsertNode', nodeToUpsert: {
 *       id: "felix/2",
 *       edges: [{ targetId: "felix/1", label: "related" }]  // HEALED from "1" to "felix/1"
 *     }
 *   }
 * ]
 * ```
 */
export function addNodeToGraphWithEdgeHealingFromFSEvent(
    fsEvent: FSUpdate,
    vaultPath: string,
    currentGraph: Graph
): GraphDelta {
    const absoluteFilePathMadeRelativeToVault: string = extractNodeIdFromPath(fsEvent.absolutePath, vaultPath)
    const parsedNode: GraphNode = parseMarkdownToGraphNode(fsEvent.content, absoluteFilePathMadeRelativeToVault, currentGraph)

    // Check if this is a new node or an update to an existing node
    console.log(`abs, ${absoluteFilePathMadeRelativeToVault} rel ${parsedNode.relativeFilePathIsID}`)
    const previousNode: O.Option<GraphNode> = O.fromNullable(currentGraph.nodes[parsedNode.relativeFilePathIsID])

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

    // Step 6: Create temporary graph with new node for edge re-validation
    const graphWithNewNode: Graph = {
        nodes: {
            ...currentGraph.nodes,
            [newNode.relativeFilePathIsID]: newNode
        }
    }


    // Step 7: Re-validate edges for each affected node (healing)
    // Nodes already have edges with raw targetIds from parseMarkdownToGraphNode
    // We just need to re-resolve those raw targetIds against the updated graph
    const healedNodesWithPrevious: readonly HealedNodeWithPrevious[] = healNodeEdges(affectedNodeIds, currentGraph, graphWithNewNode);

    // Step 8: Return GraphDelta with new node + all healed nodes
    const upsertActions: readonly UpsertNodeDelta[] = [
        {type: 'UpsertNode', nodeToUpsert: newNode, previousNode},
        ...healedNodesWithPrevious.map(({healedNode, previousNode}) => ({
            type: 'UpsertNode' as const,
            nodeToUpsert: healedNode,
            previousNode
        }))
    ]

    return upsertActions
}

/**
 * Finds all nodes that have edges potentially pointing to the newly added node.
 *
 * Uses linkMatchScore to check if any existing node has an edge with a raw targetId
 * that matches the new node's ID (handles ./, ../, and .md normalization).
 *
 * @param newNode - The newly added node
 * @param currentGraph - Current graph state
 * @returns Array of node IDs that need edge re-validation
 *
 * @example
 * ```typescript
 * // New node: "ctx-nodes/VT/foo.md"
 * // Existing nodes: { "other.md": { edges: [{ targetId: "./foo.md", ... }] } }
 * //
 * // linkMatchScore("./foo.md", "ctx-nodes/VT/foo.md") => 1 (baseNames match)
 * // => Returns ["other.md"]
 * ```
 */
function findNodesWithPotentialEdgesToNode(
    newNode: GraphNode,
    currentGraph: Graph
): readonly NodeIdAndFilePath[] {
    const newNodeId: string = newNode.relativeFilePathIsID

    // Find all nodes that have edges with targetId matching the new node
    return Object.values(currentGraph.nodes)
        .filter((node: GraphNode) =>
            node.outgoingEdges.some((edge) => linkMatchScore(edge.targetId, newNodeId) > 0)
        )
        .map((node: GraphNode) => node.relativeFilePathIsID)
}

/**
 * Extract node ID from file path by computing relative path from vault.
 *
 * it's just a QOL method so node ids aren't the full absolute path.
 *
 * @param filePath - Absolute path to the file (e.g., "/path/to/vault/subfolder/MyNote.md")
 * @param vaultPath - Absolute path to the vault (e.g., "/path/to/vault")
 * @returns GraphNode ID with relative path preserved (e.g., "subfolder/MyNote")
 */
function extractNodeIdFromPath(filePath: string, vaultPath: string): NodeIdAndFilePath {
    // todo this method seems slightly suss

    // Normalize paths to handle trailing slashes
    const normalizedVault: string = vaultPath.endsWith('/') ? vaultPath : vaultPath + '/'

    // Get relative path from vault
    const relativePath: string = filePath.startsWith(normalizedVault)
        ? filePath.substring(normalizedVault.length)
        : path.basename(filePath) // Fallback to basename if not under vault

    // Convert to node ID (todo unnec)
    return filenameToNodeId(relativePath)
}
