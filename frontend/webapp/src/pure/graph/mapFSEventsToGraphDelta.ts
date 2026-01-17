import type {FSEvent, GraphDelta, DeleteNode, NodeIdAndFilePath, FSUpdate, Graph} from '@/pure/graph/index'
import * as O from 'fp-ts/lib/Option.js'
import { filenameToNodeId } from '@/pure/graph/markdown-parsing/filename-utils'
import { addNodeToGraphWithEdgeHealingFromFSEvent } from '@/pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'

/**
 * Maps filesystem events to graph deltas.
 *
 * Pure function that converts FSEvents (filesystem changes) to GraphDeltas
 * (graph state changes). Handles:
 * - Added/Changed files → UpsertNode actions
 * - Deleted files → DeleteNode actions
 *
 * Node IDs are absolute paths (no vault path needed for ID computation).
 *
 * @param fsEvent - Filesystem event (add, change, or delete)
 * @param currentGraph - Current graph state (used to resolve wikilinks to node IDs)
 * @returns GraphDelta representing the state change
 *
 * @example
 * ```typescript
 * const fsUpdate: FSUpdate = { absolutePath: '/vault/note.md', content: '# Title', eventType: 'Added' }
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
    // Capture the deleted node for potential undo
    const deleteAction: DeleteNode = {
      type: 'DeleteNode',
      nodeId,
      deletedNode: O.fromNullable(currentGraph.nodes[nodeId])  // Include full node for undo support
    }
    return [deleteAction]
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

/**
 * Extract node ID from file path. Node IDs are absolute paths.
 *
 * @param filePath - Absolute path to the file (e.g., "/path/to/vault/subfolder/MyNote.md")
 * @returns GraphNode ID as normalized absolute path
 */
function extractNodeIdFromPath(filePath: string): NodeIdAndFilePath {
  // Node ID is the absolute path (normalized)
  return filenameToNodeId(filePath)
}
