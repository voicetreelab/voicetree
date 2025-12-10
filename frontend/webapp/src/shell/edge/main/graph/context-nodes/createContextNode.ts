import type {Graph, GraphDelta, NodeIdAndFilePath, GraphNode} from '@/pure/graph'
import {getSubgraphByDistance, graphToAscii, getNodeIdsInTraversalOrder, CONTEXT_NODES_FOLDER} from '@/pure/graph'
import {getNodeTitle} from '@/pure/graph/markdown-parsing'

/** Truncate a title to at most 5 words to prevent excessively long context node names */
function truncateToFiveWords(title: string): string {
    const words: string[] = title.split(/\s+/)
    if (words.length <= 5) return title
    return words.slice(0, 5).join(' ') + '...'
}

import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getWatchStatus} from '@/shell/edge/main/graph/watchFolder'
import {getCachedSettings} from '@/shell/edge/main/state/settings-cache'
import {DEFAULT_SETTINGS, type VTSettings} from '@/pure/settings/types'
import {fromCreateChildToUpsertNode} from '@/pure/graph/graphDelta/uiInteractionsToGraphDeltas'
import {uiAPI as _uiAPI} from '@/shell/edge/main/ui-api-proxy'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange";

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
    parentNodeId: NodeIdAndFilePath
): Promise<NodeIdAndFilePath> {
    console.log("[createContextNode] START - parentNodeId:", parentNodeId)

    // 1. EDGE: Read current graph from state
    const currentGraph: Graph = getGraph()
    console.log("[createContextNode] Got graph with", Object.keys(currentGraph.nodes).length, "nodes")

    // Validate parent node exists
    if (!currentGraph.nodes[parentNodeId]) {
        throw new Error(`Node ${parentNodeId} not found in graph`)
    }

    // 2. PURE: Extract subgraph within distance
    console.log("[createContextNode] Extracting subgraph...")
    const settings: VTSettings = getCachedSettings() ?? DEFAULT_SETTINGS
    const maxDistance: number = settings.contextNodeMaxDistance
    const subgraph: Graph = getSubgraphByDistance(
        currentGraph,
        parentNodeId,
        maxDistance
    )
    console.log("[createContextNode] Subgraph has", Object.keys(subgraph.nodes).length, "nodes")

    // 3. PURE: Convert subgraph to ASCII visualization
    console.log("[createContextNode] Converting to ASCII...")
    const asciiTree: string = graphToAscii(subgraph)
    console.log("[createContextNode] ASCII tree length:", asciiTree.length)

    // 4. EDGE: Generate unique context node ID
    const timestamp: number = Date.now()
    const parentIdWithoutExtension: string = parentNodeId.replace(/\.md$/, '')
    // Don't prepend ctx-nodes/ if the parent path already contains it (prevents infinite nesting)
    // Note: nodeIds are now relative to watchedDirectory (e.g., "monday/ctx-nodes/...") not vaultPath
    const alreadyInContextFolder: boolean = parentIdWithoutExtension.includes(`/${CONTEXT_NODES_FOLDER}/`)
        || parentIdWithoutExtension.startsWith(`${CONTEXT_NODES_FOLDER}/`)

    // Get vault suffix to properly construct context node path
    // e.g., for parent "monday/some_node", context should be "monday/ctx-nodes/some_node_context_123.md"
    const vaultSuffix: string = getWatchStatus().vaultSuffix
    const contextNodeId: string = alreadyInContextFolder
        ? `${parentIdWithoutExtension}_context_${timestamp}.md`
        : vaultSuffix
            ? `${vaultSuffix}/${CONTEXT_NODES_FOLDER}/${parentIdWithoutExtension.replace(`${vaultSuffix}/`, '')}_context_${timestamp}.md`
            : `${CONTEXT_NODES_FOLDER}/${parentIdWithoutExtension}_context_${timestamp}.md`
    console.log("[createContextNode] Generated contextNodeId:", contextNodeId)

    // 5. EDGE: Get parent node info for context
    const parentNode: GraphNode = currentGraph.nodes[parentNodeId]
    const parentTitle: string = getNodeTitle(parentNode)

    // 6. EDGE: Build markdown content with frontmatter
    console.log("[createContextNode] Building content...")
    const content: string = buildContextNodeContent(
        parentNodeId,
        parentTitle,
        maxDistance,
        asciiTree,
        subgraph
    )
    console.log("[createContextNode] Content length:", content.length)

    // 7. PURE: Create context node delta using fromCreateChildToUpsertNode
    console.log("[createContextNode] Creating delta...")
    const contextNodeDelta: GraphDelta = fromCreateChildToUpsertNode(
        currentGraph,
        parentNode,
        content,
        contextNodeId
    )
    console.log("[createContextNode] Delta created with", contextNodeDelta.length, "actions")

    // 8a. Notify UI immediately (before DB write, ensures node exists in Cytoscape for terminal anchoring)
    console.log("[createContextNode] BEFORE UIAPI")
    // void uiAPI.applyGraphDeltaToUI(contextNodeDelta) TODO

    // 8b. EDGE: Apply via GraphDelta pipeline (writes to disk)
    console.log("[createContextNode] BEFORE applyGraphDeltaToDBThroughMem")
    await applyGraphDeltaToDBThroughMemAndUIAndEditors(contextNodeDelta)
    console.log("[createContextNode] AFTER applyGraphDeltaToDBThroughMem")

    // 9. Return the created node ID
    console.log("[createContextNode] DONE - returning:", contextNodeId)
    return contextNodeId
}

/**
 * Builds the markdown content for a context node
 */
function buildContextNodeContent(
    parentNodeId: NodeIdAndFilePath,
    parentTitle: string,
    _maxDistance: number,
    asciiTree: string,
    subgraph: Graph
): string {
    // todo this should be done by creatingGraphNode, and then calling to markdown function on it.
    const nodeDetailsList: string = generateNodeDetailsList(subgraph, parentNodeId)

    // Collect all node IDs from the subgraph (excluding context nodes to prevent self-referencing)
    const containedNodeIds: readonly string[] = Object.keys(subgraph.nodes)
        .filter(nodeId => !subgraph.nodes[nodeId].nodeUIMetadata.isContextNode)

    // Format containedNodeIds as YAML array
    const containedNodeIdsYaml: string = containedNodeIds.length > 0
        ? `containedNodeIds:\n${containedNodeIds.map(id => `  - ${id}`).join('\n')}\n`
        : ''

    return `---
title: "CONTEXT for: '${truncateToFiveWords(parentTitle)}'"
isContextNode: true
${containedNodeIdsYaml}---

## CONTEXT for: '${parentTitle}'
\`\`\`
${asciiTree}
\`\`\`

## Node Details
${nodeDetailsList}
`
}

/**
 * Generate markdown list of node details in depth-first traversal order.
 * Matches the order of nodes in the ASCII tree visualization.
 */
function generateNodeDetailsList(
    subgraph: Graph,
    _startNodeId: NodeIdAndFilePath
): string {
    const lines: string[] = []

    // Get nodes in traversal order (same as ASCII tree)
    const orderedNodeIds: readonly string[] = getNodeIdsInTraversalOrder(subgraph)

    for (const nodeId of orderedNodeIds) {
        const node: GraphNode = subgraph.nodes[nodeId]
        // Skip context nodes to prevent self-referencing in generated context
        if (node.nodeUIMetadata.isContextNode) {
            continue
        }
        // Strip [link]* markers to prevent them being converted back to [[link]] wikilinks when written to disk.
        // Without this, fromNodeToMarkdownContent would create real edges from context node to all embedded nodes.
        const contentWithoutLinkStars: string = node.contentWithoutYamlOrLinks.replace(/\[([^\]]+)\]\*/g, '[$1]')
        lines.push(`<${node.relativeFilePathIsID}> \n ${contentWithoutLinkStars} \n </${node.relativeFilePathIsID}>`)
    }

    // Strip [link]* markers from the start node content too
    const startNodeContent: string = subgraph.nodes[_startNodeId].contentWithoutYamlOrLinks.replace(/\[([^\]]+)\]\*/g, '[$1]')

    lines.push(`<TASK> IMPORTANT. YOUR specific task, and the most relevant context is the source note you were spawned from, which is:
        ${_startNodeId}: ${startNodeContent} </TASK>`)

    return lines.join('\n')
}
