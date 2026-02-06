import type { Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position } from '@/pure/graph'
import { ensureUniqueNodeId } from '@/pure/graph/ensureUniqueNodeId'
import { findMostConnectedNode } from '@/pure/graph/graph-operations/findMostConnectedNode'
import { parseMarkdownToGraphNode } from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
import * as O from 'fp-ts/lib/Option.js'

export interface TaskNodeCreationParams {
  readonly taskDescription: string
  readonly selectedNodeIds: readonly NodeIdAndFilePath[]
  readonly graph: Graph
  readonly writePath: string
  readonly position: Position
}

/**
 * Creates a task node with the user's description and a parent edge to the most-connected
 * node from the selection. Context node references are handled separately.
 *
 * @param params - Parameters for task node creation
 * @returns GraphDelta containing the new task node
 */
export function createTaskNode(params: TaskNodeCreationParams): GraphDelta {
  const { taskDescription, selectedNodeIds, graph, writePath, position } = params

  // Generate unique node ID
  const timestamp: number = Date.now()
  const randomSuffix: string = Math.random().toString(36).substring(2, 5)
  const candidateId: string = `${writePath}/task_${timestamp}${randomSuffix}.md`
  const existingIds: ReadonlySet<string> = new Set(Object.keys(graph.nodes))
  const nodeId: NodeIdAndFilePath = ensureUniqueNodeId(candidateId, existingIds)

  // Find most-connected node for parent relationship
  const mostConnectedNodeId: NodeIdAndFilePath = findMostConnectedNode(selectedNodeIds, graph)

  // Build markdown content with task description and parent link only.
  // Selected node references are stored in the context node, not here,
  // to avoid duplicate edges cluttering the graph.
  const markdownContent: string = `# ${taskDescription}

- parent [[${mostConnectedNodeId}]]
`

  // Parse to extract edges from wikilinks
  const parsedNode: GraphNode = parseMarkdownToGraphNode(markdownContent, nodeId, graph)

  // Create the task node with parsed content and position
  const taskNode: GraphNode = {
    absoluteFilePathIsID: nodeId,
    outgoingEdges: parsedNode.outgoingEdges,
    contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
    nodeUIMetadata: {
      ...parsedNode.nodeUIMetadata,
      position: O.some(position)
    }
  }

  return [
    {
      type: 'UpsertNode',
      nodeToUpsert: taskNode,
      previousNode: O.none
    }
  ]
}
