import type { Graph, NodeIdAndFilePath } from '@/pure/graph'
import { getSubgraphByDistance, graphToAscii, getNodeIdsInTraversalOrder } from '@/pure/graph'
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
  const currentGraph = getGraph()

  // Validate parent node exists
  if (!currentGraph.nodes[parentNodeId]) {
    throw new Error(`Node ${parentNodeId} not found in graph`)
  }

  // 2. PURE: Extract subgraph within distance 7
  const maxDistance = 7
  const subgraph = getSubgraphByDistance(
    currentGraph,
    parentNodeId,
    maxDistance
  )

  // 3. PURE: Convert subgraph to ASCII visualization
  const asciiTree = graphToAscii(subgraph)

  // 4. EDGE: Generate unique context node ID
  const timestamp = Date.now()
  const contextNodeId = `ctx-nodes/${parentNodeId}_context_${timestamp}.md`

  // 5. EDGE: Get parent node info for context
  const parentNode = currentGraph.nodes[parentNodeId]
  const parentTitle = parentNode.nodeUIMetadata.title

  // 6. EDGE: Build markdown content with frontmatter
  const content = buildContextNodeContent(
    parentNodeId,
    parentTitle,
    maxDistance,
    asciiTree,
    subgraph
  )

  // 7. PURE: Create context node delta using fromCreateChildToUpsertNode
  const contextNodeDelta = fromCreateChildToUpsertNode(
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
  const nodeDetailsList = generateNodeDetailsList(subgraph, parentNodeId)

  return `---
title: Context for ${parentTitle}
---

## Relevant context graph for: ${parentTitle}
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
  const orderedNodeIds = getNodeIdsInTraversalOrder(subgraph)

  for (const nodeId of orderedNodeIds) {
    const node = subgraph.nodes[nodeId]
    lines.push(`<${node.relativeFilePathIsID}> \n ${node.contentWithoutYamlOrLinks} \n </${node.relativeFilePathIsID}>`)
  }

  return lines.join('\n')
}
