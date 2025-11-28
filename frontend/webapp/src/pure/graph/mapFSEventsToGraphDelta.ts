import type {FSEvent, GraphDelta, DeleteNode, NodeIdAndFilePath, FSUpdate, Graph, GraphNode} from '@/pure/graph/index'
import path from 'path'
import { filenameToNodeId } from '@/pure/graph/markdown-parsing/filename-utils'
import { addNodeToGraph } from '@/pure/graph/graphDelta/addNodeToGraph'

/**
 * Maps filesystem events to graph deltas.
 *
 * Pure function that converts FSEvents (filesystem changes) to GraphDeltas
 * (graph state changes). Handles:
 * - Added/Changed files → UpsertNode actions
 * - Deleted files → DeleteNode actions
 *
 * Function signature: (FSEvent, vaultPath, currentGraph) -> GraphDelta
 *
 * @param fsEvent - Filesystem event (add, change, or delete)
 * @param vaultPath - Absolute path to vault (used to compute relative node IDs)
 * @param currentGraph - Current graph state (used to resolve wikilinks to node IDs)
 * @returns GraphDelta representing the state change
 *
 * @example
 * ```typescript
 * const fsUpdate: FSUpdate = { absolutePath: '/vault/note.md', content: '# Title', eventType: 'Added' }
 * const currentGraph = { nodes: { ... } }
 * const delta = mapFSEventsToGraphDelta(fsUpdate, '/vault', currentGraph)
 * // delta = [{ type: 'UpsertNode', nodeToUpsert: {...} }]
 * ```
 */
export function mapFSEventsToGraphDelta(fsEvent: FSEvent, vaultPath: string, currentGraph: Graph): GraphDelta {
  // Discriminate based on type field for FSDelete, or content field for FSUpdate
  if ('type' in fsEvent && fsEvent.type === 'Delete') {
    // This is FSDelete
    const nodeId: string = extractNodeIdFromPath(fsEvent.absolutePath, vaultPath)
    // Capture the deleted node for potential undo
    const deletedNode: GraphNode | undefined = currentGraph.nodes[nodeId]
    const deleteAction: DeleteNode = {
      type: 'DeleteNode',
      nodeId,
      deletedNode  // Include full node for undo support
    }
    return [deleteAction]
  } else {
    // This is FSUpdate (Added or Changed)
    const fsUpdate: FSUpdate = fsEvent as FSUpdate
    return handleUpsert(fsUpdate, vaultPath, currentGraph)
  }
}

/**
 * Handle add/change events by creating an upsert action.
 * Uses the unified addNodeToGraph function for progressive edge validation.
 */
function handleUpsert(fsUpdate: FSUpdate, vaultPath: string, currentGraph: Graph): GraphDelta {
  // Use unified function - handles both outgoing and incoming edge validation
  return addNodeToGraph(fsUpdate, vaultPath, currentGraph)
}

/**
 * Extract node ID from file absolutePath by computing relative absolutePath from vault.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param filePath - Absolute absolutePath to the file (e.g., "/absolutePath/to/vault/subfolder/MyNote.md")
 * @param vaultPath - Absolute absolutePath to the vault (e.g., "/absolutePath/to/vault")
 * @returns GraphNode ID with relative absolutePath preserved (e.g., "subfolder/MyNote")
 */
function extractNodeIdFromPath(filePath: string, vaultPath: string): NodeIdAndFilePath {
  // Normalize paths to handle trailing slashes
  const normalizedVault: string = vaultPath.endsWith('/') ? vaultPath : vaultPath + '/'

  // Get relative absolutePath from vault
  const relativePath: string = filePath.startsWith(normalizedVault)
    ? filePath.substring(normalizedVault.length)
    : path.basename(filePath) // Fallback to basename if not under vault

  // Convert to node ID (remove .md extension)
  return filenameToNodeId(relativePath)
}
