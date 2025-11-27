import type {FSUpdate, Graph, GraphDelta, GraphNode, NodeIdAndFilePath, UpsertNodeAction} from '@/pure/graph'
import path from 'path'
import {parseMarkdownToGraphNode} from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
import {extractPathSegments, findBestMatchingNode} from '@/pure/graph/markdown-parsing/extract-edges'
import {setOutgoingEdges} from '@/pure/graph/graph-operations /graph-edge-operations'
import {filenameToNodeId} from '@/pure/graph/markdown-parsing/filename-utils'

function healNodeEdges(affectedNodeIds: readonly NodeIdAndFilePath[], currentGraph: Graph, graphWithNewNode: Graph): readonly GraphNode[] {
    const healedNodes: readonly GraphNode[] = affectedNodeIds.map((affectedNodeId) => {
        const affectedNode: GraphNode = currentGraph.nodes[affectedNodeId]

        // Re-resolve the existing edges against the updated graph
        const healedEdges: readonly { readonly targetId: string; readonly label: string; }[] = affectedNode.outgoingEdges.map((edge) => {
            // Try to resolve the raw targetId to an actual node
            //todo suss
            const resolvedTargetId: string | undefined = findBestMatchingNode(edge.targetId, graphWithNewNode.nodes)
            return {
                ...edge,
                targetId: resolvedTargetId ?? edge.targetId
            }
        })

        return setOutgoingEdges(affectedNode, healedEdges)
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
export function addNodeToGraph(
    fsEvent: FSUpdate,
    vaultPath: string,
    currentGraph: Graph
): GraphDelta {
    const absoluteFilePathMadeRelativeToVault: string = extractNodeIdFromPath(fsEvent.absolutePath, vaultPath)
    const newNode: GraphNode = parseMarkdownToGraphNode(fsEvent.content, absoluteFilePathMadeRelativeToVault, currentGraph) // todo this should take graph

    const affectedNodeIds: readonly string[] = findNodesWithPotentialEdgesToNode(newNode, currentGraph)

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
    const healedNodes: readonly GraphNode[] = healNodeEdges(affectedNodeIds, currentGraph, graphWithNewNode);

    // Step 8: Return GraphDelta with new node + all healed nodes
    const upsertActions: readonly UpsertNodeAction[] = [
        {type: 'UpsertNode', nodeToUpsert: newNode},
        ...healedNodes.map((healedNode) => ({
            type: 'UpsertNode' as const,
            nodeToUpsert: healedNode
        }))
    ]

    return upsertActions
}

/**
 * Finds all nodes that have edges potentially pointing to the newly added node.
 *
 * Uses smart matching: checks if any existing node has an edge with a raw targetId
 * that matches any path segment of the new node.
 *
 * @param newNode - The newly added node
 * @param currentGraph - Current graph state
 * @returns Array of node IDs that need edge re-validation
 *
 * @example
 * ```typescript
 * // New node: "felix/1"
 * // Existing nodes: { "felix/2": { edges: [{ targetId: "1", ... }] } }
 * //
 * // extractPathSegments("felix/1") => ["felix/1", "1"]
 * // "felix/2" has edge with targetId="1" which matches segment "1"
 * // => Returns ["felix/2"]
 * ```
 */
function findNodesWithPotentialEdgesToNode(
    newNode: GraphNode,
    currentGraph: Graph
): readonly NodeIdAndFilePath[] {
    // Extract all possible path segments from the new node's ID
    // e.g., "felix/1" => ["felix/1", "1"] and the ones with .md
    const segments: readonly string[] = extractPathSegments(newNode.relativeFilePathIsID)

    // Find all nodes that have edges with targetId matching any segment
    return Object.values(currentGraph.nodes)
        .filter((node) =>
            node.outgoingEdges.some((edge) => segments.includes(edge.targetId))
        )
        .map((node) => node.relativeFilePathIsID)
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
