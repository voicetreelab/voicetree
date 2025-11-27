import type {Graph, GraphDelta, NodeIdAndFilePath} from '@/pure/graph'
import { getSubgraphByDistance, graphToAscii, getNodeIdsInTraversalOrder } from '@/pure/graph'

/** Folder where context nodes are stored */
export const CONTEXT_NODES_FOLDER: "ctx-nodes" = 'ctx-nodes'

/** Truncate a title to at most 5 words to prevent excessively long context node names */
function truncateToFiveWords(title: string): string {
  const words: string[] = title.split(/\s+/)
  if (words.length <= 5) return title
  return words.slice(0, 5).join(' ') + '...'
}

import { getGraph } from '@/shell/edge/main/state/graph-store'
import { applyGraphDeltaToDBThroughMem } from '@/shell/edge/main/graph/writePath/applyGraphDeltaToDBThroughMem'
import { fromCreateChildToUpsertNode } from '@/pure/graph/graphDelta/uiInteractionsToGraphDeltas'

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
  // 1. EDGE: Read current graph from state
  const currentGraph: Graph = getGraph()

  // Validate parent node exists
  if (!currentGraph.nodes[parentNodeId]) {
    throw new Error(`Node ${parentNodeId} not found in graph`)
  }

  // 2. PURE: Extract subgraph within distance 7
  const maxDistance: 5 = 5 as const
  const subgraph: Graph = getSubgraphByDistance(
    currentGraph,
    parentNodeId,
    maxDistance
  )

  // 3. PURE: Convert subgraph to ASCII visualization
  const asciiTree: string = graphToAscii(subgraph)

  // 4. EDGE: Generate unique context node ID
  const timestamp: number = Date.now()
  const contextNodeId: string = `${CONTEXT_NODES_FOLDER}/${parentNodeId}_context_${timestamp}.md`

  // 5. EDGE: Get parent node info for context
  const parentNode: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphNode = currentGraph.nodes[parentNodeId]
  const parentTitle: string = parentNode.nodeUIMetadata.title

  // 6. EDGE: Build markdown content with frontmatter
  const content: string = buildContextNodeContent(
    parentNodeId,
    parentTitle,
    maxDistance,
    asciiTree,
    subgraph
  )

  // 7. PURE: Create context node delta using fromCreateChildToUpsertNode
  const contextNodeDelta: GraphDelta = fromCreateChildToUpsertNode(
    currentGraph,
    parentNode,
    content,
    contextNodeId
  )

  // 8. EDGE: Apply via GraphDelta pipeline
  await applyGraphDeltaToDBThroughMem(contextNodeDelta)

  // 9. Return the created node ID
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
    const node: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/src/pure/graph/index").GraphNode = subgraph.nodes[nodeId]
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
