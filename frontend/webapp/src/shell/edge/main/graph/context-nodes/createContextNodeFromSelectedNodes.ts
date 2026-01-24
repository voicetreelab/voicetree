/**
 * Creates a context node from explicitly selected nodes.
 *
 * Unlike createContextNode which uses distance-based subgraph extraction,
 * this function creates a context node from an explicit list of selected nodes.
 * Used for "Run Agent on Selected Nodes" feature.
 */

import type { Graph, GraphDelta, NodeIdAndFilePath, GraphNode } from '@/pure/graph'
import { CONTEXT_NODES_FOLDER } from '@/pure/graph'
import { getNodeTitle, parseMarkdownToGraphNode } from '@/pure/graph/markdown-parsing'
import { getGraph } from '@/shell/edge/main/state/graph-store'
import { getWritePath } from '@/shell/edge/main/graph/watch_folder/watchFolder'
import * as O from 'fp-ts/lib/Option.js'
import { calculateInitialPositionForChild } from '@/pure/graph/positioning/calculateInitialPosition'
import {
  applyGraphDeltaToDBThroughMemAndUIAndEditors
} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import { ensureUniqueNodeId } from '@/pure/graph/ensureUniqueNodeId'

/**
 * Creates a context node from explicitly selected nodes.
 *
 * @param taskNodeId - The task node this context belongs to (for positioning)
 * @param selectedNodeIds - The explicitly selected node IDs to include in context
 * @returns The NodeId of the newly created context node
 */
export async function createContextNodeFromSelectedNodes(
  taskNodeId: NodeIdAndFilePath,
  selectedNodeIds: readonly NodeIdAndFilePath[]
): Promise<NodeIdAndFilePath> {
  const currentGraph: Graph = getGraph()

  // Validate task node exists
  const taskNode: GraphNode | undefined = currentGraph.nodes[taskNodeId]
  if (!taskNode) {
    throw new Error(`Task node ${taskNodeId} not found in graph`)
  }

  // Filter to valid node IDs
  const validNodeIds: readonly NodeIdAndFilePath[] = selectedNodeIds
    .filter((id: NodeIdAndFilePath) => currentGraph.nodes[id])

  if (validNodeIds.length === 0) {
    throw new Error('No valid nodes found in selection')
  }

  // Generate unique context node ID
  const timestamp: number = Date.now()
  const writePathOption: O.Option<string> = await getWritePath()
  const writePath: string = O.getOrElse(() => '')(writePathOption)
  const candidateContextNodeId: string = `${writePath}/${CONTEXT_NODES_FOLDER}/task_context_${timestamp}.md`
  const existingIds: ReadonlySet<string> = new Set(Object.keys(currentGraph.nodes))
  const contextNodeId: string = ensureUniqueNodeId(candidateContextNodeId, existingIds)

  // Build markdown content
  const content: string = buildContextNodeContent(
    taskNodeId,
    validNodeIds,
    currentGraph
  )

  // Parse to create node with correct frontmatter handling
  const parsedNode: GraphNode = parseMarkdownToGraphNode(content, contextNodeId, currentGraph)

  // Create context node with position near task node
  const contextNode: GraphNode = {
    absoluteFilePathIsID: contextNodeId,
    outgoingEdges: parsedNode.outgoingEdges,
    contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
    nodeUIMetadata: {
      ...parsedNode.nodeUIMetadata,
      position: calculateInitialPositionForChild(taskNode, currentGraph, undefined, 100),
    },
  }

  const contextNodeDelta: GraphDelta = [
    {
      type: 'UpsertNode',
      nodeToUpsert: contextNode,
      previousNode: O.none
    }
  ]

  // Apply to graph
  await applyGraphDeltaToDBThroughMemAndUIAndEditors(contextNodeDelta)

  return contextNodeId
}

/**
 * Builds markdown content for the context node.
 */
function buildContextNodeContent(
  taskNodeId: NodeIdAndFilePath,
  selectedNodeIds: readonly NodeIdAndFilePath[],
  graph: Graph
): string {
  // Build node details list
  const nodeDetailsList: string = generateNodeDetailsList(selectedNodeIds, graph)

  // Format containedNodeIds as YAML array
  const containedNodeIdsYaml: string = selectedNodeIds.length > 0
    ? `containedNodeIds:\n${selectedNodeIds.map((id: NodeIdAndFilePath) => `  - ${id}`).join('\n')}\n`
    : ''

  const taskNode: GraphNode = graph.nodes[taskNodeId]
  const taskTitle: string = taskNode ? getNodeTitle(taskNode) : 'Task'

  return `---
title: "ctx: ${taskTitle}"
isContextNode: true
${containedNodeIdsYaml}---
# context
Context for task: ${taskNodeId}

## Node Contents
${nodeDetailsList}

<TASK> IMPORTANT. YOUR specific task, and the most relevant context is the source note you were spawned from, which is:
        ${taskNodeId}: ${taskNode ? taskNode.contentWithoutYamlOrLinks : ''} </TASK>
`
}

/**
 * Generate markdown list of node details for selected nodes.
 */
function generateNodeDetailsList(
  selectedNodeIds: readonly NodeIdAndFilePath[],
  graph: Graph
): string {
  const lines: string[] = []

  for (const nodeId of selectedNodeIds) {
    const node: GraphNode | undefined = graph.nodes[nodeId]
    if (!node) continue

    // Skip context nodes to prevent self-referencing
    if (node.nodeUIMetadata.isContextNode) {
      continue
    }

    // Strip [link]* markers to prevent them being converted back to wikilinks
    const contentWithoutLinkStars: string = node.contentWithoutYamlOrLinks.replace(/\[([^\]]+)\]\*/g, '[$1]')
    lines.push(`<${node.absoluteFilePathIsID}> \n ${contentWithoutLinkStars} \n </${node.absoluteFilePathIsID}>`)
  }

  return lines.join('\n')
}
