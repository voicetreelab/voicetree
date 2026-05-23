import type { Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position } from '../..'
import { ensureUniqueNodeId, parseMarkdownToGraphNode, stableIdSuffix } from '../graphOperationPrimitives'
import { findMostConnectedNode } from '../indexes/findMostConnectedNode'
import * as O from 'fp-ts/lib/Option.js'

export interface TaskNodeCreationParams {
  readonly taskDescription: string
  readonly selectedNodeIds: readonly NodeIdAndFilePath[]
  readonly graph: Graph
  readonly writeFolder: string
  readonly position: Position
  readonly initialStatus?: string
}

function createTaskNodeCandidateId(
  writeFolder: string,
  taskDescription: string,
  selectedNodeIds: readonly NodeIdAndFilePath[]
): NodeIdAndFilePath {
  const separator: string = writeFolder.endsWith('/') ? '' : '/'
  const suffix: string = stableIdSuffix([writeFolder, taskDescription, ...selectedNodeIds])
  return `${writeFolder}${separator}task_${suffix}.md`
}

/**
 * Creates a task node with the user's description and a parent edge to the most-connected
 * node from the selection. Context node references are handled separately.
 *
 * @param params - Parameters for task node creation
 * @returns GraphDelta containing the new task node
 */
export function createTaskNode(params: TaskNodeCreationParams): GraphDelta {
  const { taskDescription, selectedNodeIds, graph, writeFolder, position, initialStatus } = params

  const existingIds: ReadonlySet<string> = new Set(Object.keys(graph.nodes))
  const candidateId: NodeIdAndFilePath = createTaskNodeCandidateId(writeFolder, taskDescription, selectedNodeIds)
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

  // Merge optional initial YAML props (e.g. status='claimed') into parsed props.
  // Lets callers create the node already-claimed, avoiding a redundant second write.
  const additionalYAMLProps: ReadonlyMap<string, string> = initialStatus
    ? new Map([...parsedNode.nodeUIMetadata.additionalYAMLProps, ['status', initialStatus]])
    : parsedNode.nodeUIMetadata.additionalYAMLProps

  // Create the task node with parsed content and position
  const taskNode: GraphNode = {
    kind: 'leaf',
    absoluteFilePathIsID: nodeId,
    outgoingEdges: parsedNode.outgoingEdges,
    contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
    nodeUIMetadata: {
      ...parsedNode.nodeUIMetadata,
      position: O.some(position),
      additionalYAMLProps
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
