import type {
  DeleteNode,
  FSEvent,
  FSUpdate,
  Graph,
  GraphDelta,
  GraphNode,
  NodeIdAndFilePath,
  UpsertNodeDelta
} from '..'
import * as O from 'fp-ts/lib/Option.js'
import { filenameToNodeId } from '../markdown-parsing/filename-utils'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from '../graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
import { getMarkdownLinkTargetBasename } from '../graph-operations/indexes/linkResolutionIndexes'
import { setOutgoingEdges } from '../graph-operations/transforms/graph-edge-operations'

/**
 * Maps filesystem events to graph deltas.
 *
 * Pure function that converts FSEvents (filesystem changes) to GraphDeltas
 * (graph state changes). Handles:
 * - Added/Changed files → UpsertNode actions
 * - Deleted files → DeleteNode actions
 *
 * Important contract:
 * - The watcher path does not have a dedicated rename event.
 * - Chokidar surfaces filesystem moves as delete + add.
 * - Basename-stable moves are healed on the add step via unresolved-link indexes.
 * - Basename-changing renames require a higher-level rename workflow that also
 *   rewrites references; they are not inferred from watcher events alone.
 *
 * Node IDs are absolute paths (no project path needed for ID computation).
 *
 * @param fsEvent - Filesystem event (add, change, or delete)
 * @param currentGraph - Current graph state (used to resolve wikilinks to node IDs)
 * @returns GraphDelta representing the state change
 *
 * @example
 * ```typescript
 * const fsUpdate: FSUpdate = { absolutePath: '/project/note.md', content: '# Title', eventType: 'Added' }
 * const currentGraph = { nodes: { ... } }
 * const delta = mapFSEventsToGraphDelta(fsUpdate, currentGraph)
 * // delta = [{ type: 'UpsertNode', nodeToUpsert: {...} }]
 * ```
 */
export function mapFSEventsToGraphDelta(fsEvent: FSEvent, currentGraph: Graph): GraphDelta {
  // Discriminate based on type field for FSDelete, or content field for FSUpdate
  if ('type' in fsEvent && fsEvent.type === 'Delete') {
    // This is FSDelete - node ID is the absolute path
    const nodeId: string = extractNodeIdFromPath(fsEvent.absolutePath)
    const deletedNode: O.Option<GraphNode> = O.fromNullable(currentGraph.nodes[nodeId])
    // Capture the deleted node for potential undo
    const deleteAction: DeleteNode = {
      type: 'DeleteNode',
      nodeId,
      deletedNode  // Include full node for undo support
    }
    return [
      deleteAction,
      ...healIncomingEdgesToSameBasenameReplacement(nodeId, deletedNode, currentGraph)
    ]
  } else {
    // This is FSUpdate (Added or Changed)
    const fsUpdate: FSUpdate = fsEvent as FSUpdate
    return handleUpsert(fsUpdate, currentGraph)
  }
}

/**
 * Handle add/change events by creating an upsert action.
 * Uses the unified addNodeToGraph function for progressive edge validation.
 */
function handleUpsert(fsUpdate: FSUpdate, currentGraph: Graph): GraphDelta {
  // Use unified function - handles both outgoing and incoming edge validation
  return addNodeToGraphWithEdgeHealingFromFSEvent(fsUpdate, currentGraph)
}

function findSameBasenameMoveReplacement(
  deletedNodeId: NodeIdAndFilePath,
  deletedNode: GraphNode,
  currentGraph: Graph
): O.Option<NodeIdAndFilePath> {
  const deletedBasename: string = getMarkdownLinkTargetBasename(deletedNodeId)
  const candidateIds: readonly NodeIdAndFilePath[] = currentGraph.nodeByBaseName.get(deletedBasename) ?? []
  const matchingCandidates: readonly NodeIdAndFilePath[] = candidateIds.filter((candidateId) => {
    const candidate: GraphNode | undefined = currentGraph.nodes[candidateId]
    if (!candidate) return false

    return candidateId !== deletedNodeId
      && candidate.kind === deletedNode.kind
      && candidate.contentWithoutYamlOrLinks === deletedNode.contentWithoutYamlOrLinks
  })

  return matchingCandidates.length === 1 ? O.some(matchingCandidates[0]) : O.none
}

function redirectNodeEdges(
  node: GraphNode,
  fromNodeId: NodeIdAndFilePath,
  toNodeId: NodeIdAndFilePath
): GraphNode {
  return setOutgoingEdges(
    node,
    node.outgoingEdges.map(edge => ({
      ...edge,
      targetId: edge.targetId === fromNodeId ? toNodeId : edge.targetId
    }))
  )
}

function healIncomingEdgesToSameBasenameReplacement(
  deletedNodeId: NodeIdAndFilePath,
  deletedNode: O.Option<GraphNode>,
  currentGraph: Graph
): readonly UpsertNodeDelta[] {
  if (O.isNone(deletedNode)) return []

  const replacementNodeId: O.Option<NodeIdAndFilePath> = findSameBasenameMoveReplacement(
    deletedNodeId,
    deletedNode.value,
    currentGraph
  )
  if (O.isNone(replacementNodeId)) return []

  const sourceNodeIds: readonly NodeIdAndFilePath[] = currentGraph.incomingEdgesIndex.get(deletedNodeId) ?? []
  return sourceNodeIds.flatMap((sourceNodeId): readonly UpsertNodeDelta[] => {
    const sourceNode: GraphNode | undefined = currentGraph.nodes[sourceNodeId]
    if (!sourceNode) return []

    return [{
      type: 'UpsertNode',
      nodeToUpsert: redirectNodeEdges(sourceNode, deletedNodeId, replacementNodeId.value),
      previousNode: O.some(sourceNode)
    }]
  })
}

/**
 * Extract node ID from file path. Node IDs are absolute paths.
 *
 * @param filePath - Absolute path to the file (e.g., "/path/to/project/subfolder/MyNote.md")
 * @returns GraphNode ID as normalized absolute path
 */
function extractNodeIdFromPath(filePath: string): NodeIdAndFilePath {
  // Node ID is the absolute path (normalized)
  return filenameToNodeId(filePath)
}
