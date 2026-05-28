import path from 'path'
import type { Graph, GraphDelta, GraphNode, NodeIdAndFilePath } from '../..'
import { ensureUniqueNodeId, parseMarkdownToGraphNode, stableIdSuffix } from '../graphOperationPrimitives'
import { findMostConnectedNode } from '../indexes/findMostConnectedNode'
import * as O from 'fp-ts/lib/Option.js'

export interface TaskNodeCreationParams {
  readonly taskDescription: string
  readonly selectedNodeIds: readonly NodeIdAndFilePath[]
  readonly graph: Graph
  readonly writeFolder: string
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
  const { taskDescription, selectedNodeIds, graph, writeFolder, initialStatus } = params

  const existingIds: ReadonlySet<string> = new Set(Object.keys(graph.nodes))
  const candidateId: NodeIdAndFilePath = createTaskNodeCandidateId(writeFolder, taskDescription, selectedNodeIds)
  const nodeId: NodeIdAndFilePath = ensureUniqueNodeId(candidateId, existingIds)

  const mostConnectedNodeId: NodeIdAndFilePath = findMostConnectedNode(selectedNodeIds, graph)
  // Use basename-form wikilinks, matching human-authored convention.
  // NodeIdAndFilePath is an absolute path; the link resolver tolerates absolute
  // paths via suffix matching, but emitting basenames keeps daemon-written files
  // visually identical to user-authored files and avoids leaking machine paths.
  const parentBasename: string = path.basename(mostConnectedNodeId, '.md')

  // Build markdown content with task description and parent link only.
  // Selected node references are stored in the context node, not here,
  // to avoid duplicate edges cluttering the graph.
  //
  // The HTML comment marks this edge as system-maintained. Spawned agents
  // read this task node's body via their context node (it gets embedded
  // verbatim in the <TASK> block), and without the comment they mimic the
  // `- parent [[X]]` pattern in their own progress nodes — attaching their
  // work to the GRANDPARENT instead of defaulting to their task node. The
  // comment makes the daemon-vs-author distinction visible to the LLM.
  const markdownContent: string = `# ${taskDescription}

<!-- system-managed parent edge — do not mimic this pattern in your own progress nodes -->
- parent [[${parentBasename}]]
`

  const parsedNode: GraphNode = parseMarkdownToGraphNode(markdownContent, nodeId, graph)

  // Merge optional initial YAML props (e.g. status='claimed') into parsed props.
  // Lets callers create the node already-claimed, avoiding a redundant second write.
  const additionalYAMLProps: Record<string, string> = initialStatus
    ? { ...parsedNode.nodeUIMetadata.additionalYAMLProps, status: initialStatus }
    : parsedNode.nodeUIMetadata.additionalYAMLProps

  // Position deliberately left O.none — the daemon's resolveInitialPositionsForDelta
  // fills it in from the parent edge at apply-time, keeping authoring pure.
  const taskNode: GraphNode = {
    kind: 'leaf',
    absoluteFilePathIsID: nodeId,
    outgoingEdges: parsedNode.outgoingEdges,
    contentWithoutYamlOrLinks: parsedNode.contentWithoutYamlOrLinks,
    nodeUIMetadata: {
      ...parsedNode.nodeUIMetadata,
      position: O.none,
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
