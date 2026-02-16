import type {Graph, GraphDelta, NodeIdAndFilePath, GraphNode} from '@/pure/graph'
import {getSubgraphByDistance, getUnionSubgraphByDistance, graphToAscii, makeBidirectionalEdges, CONTEXT_NODES_FOLDER} from '@/pure/graph'
import {askQuery, type SearchSimilarResult} from '@/shell/edge/main/backend-api'
import {getNodeTitle, parseMarkdownToGraphNode} from '@/pure/graph/markdown-parsing'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {loadSettings} from '@/shell/edge/main/settings/settings_IO'
import * as O from 'fp-ts/lib/Option.js'
import path from 'path'
import {type VTSettings} from '@/pure/settings/types'
import {calculateInitialPositionForChild} from '@/pure/graph/positioning/calculateInitialPosition'
import {uiAPI as _uiAPI} from '@/shell/edge/main/ui-api-proxy'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange";
import {ensureUniqueNodeId} from "@/pure/graph/ensureUniqueNodeId";
import {traceSync} from '@/shell/edge/main/tracing/trace'
import {getWritePath} from "@/shell/edge/main/graph/watch_folder/vault-allowlist";

/**
 * Get semantically relevant nodes via vector search with timeout.
 * Returns empty array on error/timeout (graceful fallback).
 *
 * @param query - The text to search for
 * @param topK - Number of results to return
 * @returns Array of node paths from semantic search
 */
async function getSemanticRelevantNodes(
    query: string,
    topK: number
): Promise<readonly NodeIdAndFilePath[]> {
    if (topK <= 0 || !query.trim()) return []

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1000)

    try {
        // Race the askQuery against the abort signal
        const response = await Promise.race([
            askQuery(query, topK),
            new Promise<never>((_, reject) => {
                controller.signal.addEventListener('abort', () => {
                    reject(new Error('Timeout'))
                })
            })
        ])
        clearTimeout(timeoutId)
        return response.relevant_nodes.map((n: SearchSimilarResult) => n.node_path)
    } catch {
        // Timeout or error: graceful fallback to distance-only
        clearTimeout(timeoutId)
        return []
    }
}

/**
 * Creates a context node for a given parent node.
 *
 * This orchestrator function:
 * 1. Extracts subgraph within distance 7 using weighted BFS
 * 2. Converts subgraph to ASCII visualization
 * 3. Creates a new context node with the visualization
 * 4. Persists via GraphDelta pipeline
 *
 * @param parentNodeId - The node to create context for
 * @returns The NodeId of the newly created context node
 */
export async function createContextNode(
    parentNodeId: NodeIdAndFilePath,
    agentInstructions?: string
): Promise<NodeIdAndFilePath> {
    //console.log("[createContextNode] START - parentNodeId:", parentNodeId)

    // 1. EDGE: Read current graph from state
    const currentGraph: Graph = getGraph()
    //console.log("[createContextNode] Got graph with", Object.keys(currentGraph.nodes).length, "nodes")

    // Validate parent node exists
    if (!currentGraph.nodes[parentNodeId]) {
        throw new Error(`Node ${parentNodeId} not found in graph`)
    }

    // 2. PURE: Extract subgraph within distance
    const settings: VTSettings = await loadSettings()
    const maxDistance: number = settings.contextNodeMaxDistance

    // Reuse contextNodeMaxDistance for vector search top_k
    const contextVectorSearchTopK: number = maxDistance
    const parentNode: GraphNode = currentGraph.nodes[parentNodeId]

    // Get semantically relevant nodes via vector search (with 1s timeout)
    const semanticNodeIds: readonly NodeIdAndFilePath[] = await getSemanticRelevantNodes(
        parentNode.contentWithoutYamlOrLinks,
        contextVectorSearchTopK
    )

    // Get subgraph - union if we have semantic results, otherwise distance-only
    const subgraph: Graph = traceSync('getSubgraphByDistance', () =>
        semanticNodeIds.length > 0
            ? getUnionSubgraphByDistance(
                currentGraph,
                [parentNodeId, ...semanticNodeIds],
                maxDistance
            )
            : getSubgraphByDistance(currentGraph, parentNodeId, maxDistance)
    )
    //console.log("[createContextNode] Subgraph has", Object.keys(subgraph.nodes).length, "nodes")

    // 3. PURE: Convert subgraph to ASCII visualization
    // Make edges bidirectional so parents are shown as "children" in the tree.
    // This ensures nodes reachable via incoming edges (parents) appear in the ASCII tree,
    // not just nodes reachable via outgoing edges (children).
    const asciiTree: string = traceSync('graphToAscii', () => {
        const bidirectionalSubgraph: Graph = makeBidirectionalEdges(subgraph)
        return graphToAscii(bidirectionalSubgraph, parentNodeId)
    })
    //console.log("[createContextNode] ASCII tree length:", asciiTree.length)

    // 4. EDGE: Generate unique context node ID
    const timestamp: number = Date.now()
    const parentIdWithoutExtension: string = parentNodeId.replace(/\.md$/, '')
    // Don't prepend ctx-nodes/ if the parent path already contains it (prevents infinite nesting)
    // Note: nodeIds are now relative to projectRootWatchedDirectory (e.g., "monday/ctx-nodes/...") not vaultPath
    const alreadyInContextFolder: boolean = parentIdWithoutExtension.includes(`/${CONTEXT_NODES_FOLDER}/`)
        || parentIdWithoutExtension.startsWith(`${CONTEXT_NODES_FOLDER}/`)

    // Get write path (absolute) to properly construct context node path
    // Context nodes go in {writePath}/ctx-nodes/
    const writePathOption: O.Option<string> = await getWritePath()
    const writePath: string = O.getOrElse(() => '')(writePathOption)
    const candidateContextNodeId: string = alreadyInContextFolder
        ? `${parentIdWithoutExtension}_context_${timestamp}.md`
        : `${writePath}/${CONTEXT_NODES_FOLDER}/${path.basename(parentIdWithoutExtension)}_context_${timestamp}.md`
    // Ensure unique ID by appending _2, _3, etc. if collision exists
    const existingIds: ReadonlySet<string> = new Set(Object.keys(currentGraph.nodes))
    const contextNodeId: string = ensureUniqueNodeId(candidateContextNodeId, existingIds)
    //console.log("[createContextNode] Generated contextNodeId:", contextNodeId)

    // 5. EDGE: Get parent node info for context
    const parentTitle: string = getNodeTitle(parentNode)

    // 6. EDGE: Build markdown content with frontmatter
    // Context node is orphaned (no edges to task node) - terminal shadow will connect to it
    //console.log("[createContextNode] Building content...")
    const content: string = buildContextNodeContent(
        parentNodeId,
        parentTitle,
        maxDistance,
        asciiTree,
        subgraph,
        semanticNodeIds,
        agentInstructions
    )
    //console.log("[createContextNode] Content length:", content.length)

    // 7. PURE: Create orphaned context node (no parent edge)
    // The terminal's shadow node will create a cytoscape edge to this context node
    //console.log("[createContextNode] Creating delta for orphaned context node...")
    const parsedNode: GraphNode = parseMarkdownToGraphNode(content, contextNodeId, currentGraph)
    const contextNode: GraphNode = {
        absoluteFilePathIsID: contextNodeId,
        outgoingEdges: parsedNode.outgoingEdges,
        contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            ...parsedNode.nodeUIMetadata,
            position: calculateInitialPositionForChild(parentNode, currentGraph, undefined, 100),
        },
    }
    const contextNodeDelta: GraphDelta = [
        {
            type: 'UpsertNode',
            nodeToUpsert: contextNode,
            previousNode: O.none
        }
    ]
    //console.log("[createContextNode] Delta created with", contextNodeDelta.length, "actions (orphaned, no parent edge)")

    // 8a. Notify UI immediately (before DB write, ensures node exists in Cytoscape for terminal anchoring)
    //console.log("[createContextNode] BEFORE UIAPI")
    // void uiAPI.applyGraphDeltaToUI(contextNodeDelta) TODO

    // 8b. EDGE: Apply via GraphDelta pipeline (writes to disk)
    //console.log("[createContextNode] BEFORE applyGraphDeltaToDBThroughMem")
    await applyGraphDeltaToDBThroughMemAndUIAndEditors(contextNodeDelta)
    //console.log("[createContextNode] AFTER applyGraphDeltaToDBThroughMem")

    // 9. Return the created node ID
    //console.log("[createContextNode] DONE - returning:", contextNodeId)
    return contextNodeId
}

/**
 * Builds the markdown content for a context node
 */
function buildContextNodeContent(
    parentNodeId: NodeIdAndFilePath,
    _parentTitle: string,
    _maxDistance: number,
    asciiTree: string,
    subgraph: Graph,
    semanticNodeIds: readonly NodeIdAndFilePath[],
    agentInstructions?: string
): string {
    // todo this should be done by creatingGraphNode, and then calling to markdown function on it.
    const nodeDetailsList: string = generateNodeDetailsList(subgraph, parentNodeId, semanticNodeIds, agentInstructions)

    // Collect all node IDs from the subgraph (excluding context nodes to prevent self-referencing)
    const containedNodeIds: readonly string[] = Object.keys(subgraph.nodes)
        .filter(nodeId => !subgraph.nodes[nodeId].nodeUIMetadata.isContextNode)

    // Format containedNodeIds as YAML array
    const containedNodeIdsYaml: string = containedNodeIds.length > 0
        ? `containedNodeIds:\n${containedNodeIds.map(id => `  - ${id}`).join('\n')}\n`
        : ''

    // Context node is orphaned - no wikilink edge to parent
    // The terminal's shadow node will create a cytoscape edge to this context node
    return `---
title: "ctx"
isContextNode: true
${containedNodeIdsYaml}---
# ctx
Nearby nodes to: ${parentNodeId}
\`\`\`
${asciiTree}
\`\`\`

## Node Contents 
${nodeDetailsList}

`
}

/**
 * Generate markdown list of node details in depth-first traversal order.
 * Matches the order of nodes in the ASCII tree visualization.
 * Nodes found via semantic search are marked with [SEMANTIC].
 */
function generateNodeDetailsList(
    subgraph: Graph,
    _startNodeId: NodeIdAndFilePath,
    semanticNodeIds: readonly NodeIdAndFilePath[],
    agentInstructions?: string
): string {
    const lines: string[] = []

    // Iterate over all nodes in subgraph
    // Note: Order won't match ASCII tree exactly, but ensures all nodes are included
    // (getNodeIdsInTraversalOrder only follows outgoing edges, missing nodes reachable via incoming edges)
    for (const nodeId of Object.keys(subgraph.nodes)) {
        const node: GraphNode = subgraph.nodes[nodeId]
        // Skip context nodes to prevent self-referencing in generated context
        if (node.nodeUIMetadata.isContextNode) {
            continue
        }
        // Mark nodes found via semantic search
        const isSemantic: boolean = semanticNodeIds.includes(nodeId)
        const marker: string = isSemantic ? ' [SEMANTIC]' : ''
        // Convert [link]* markers to [\[link]\] to show they were wikilinks, while preventing them from
        // being parsed as actual [[link]] wikilinks when written to disk.
        const contentWithoutLinkStars: string = node.contentWithoutYamlOrLinks.replace(/\[([^\]]+)\]\*/g, '[\\[$1]\\]')
        lines.push(`<${node.absoluteFilePathIsID}>${marker} \n ${contentWithoutLinkStars} \n </${node.absoluteFilePathIsID}>`)
    }

    // Convert [link]* markers from the start node content too
    const startNodeContent: string = subgraph.nodes[_startNodeId].contentWithoutYamlOrLinks.replace(/\[([^\]]+)\]\*/g, '[\\[$1]\\]')

    lines.push(`<TASK> IMPORTANT. YOUR specific task, and the most relevant context is the source note you were spawned from, which is:
        ${_startNodeId}: ${startNodeContent} </TASK>`)

    if (agentInstructions) {
        lines.push(`<AGENT_INSTRUCTIONS>\n${agentInstructions}\n</AGENT_INSTRUCTIONS>`)
    }

    return lines.join('\n')
}
