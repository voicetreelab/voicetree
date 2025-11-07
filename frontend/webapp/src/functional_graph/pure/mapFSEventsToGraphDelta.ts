import type {FSEvent, GraphDelta, DeleteNode, UpsertNodeAction, GraphNode, NodeId, FSUpdate} from '@/functional_graph/pure/types'
import * as O from 'fp-ts/lib/Option.js'
import path from 'path'
import { filenameToNodeId } from '@/functional_graph/pure/markdown_parsing/filename-utils'
import { setOutgoingEdges } from '@/functional_graph/pure/graph-edge-operations'

/**
 * Maps filesystem events to graph deltas.
 *
 * Pure function that converts FSEvents (filesystem changes) to GraphDeltas
 * (graph state changes). Handles:
 * - Added/Changed files → UpsertNode actions
 * - Deleted files → DeleteNode actions
 *
 * Function signature: (FSEvent, vaultPath) -> GraphDelta
 *
 * @param fsEvent - Filesystem event (add, change, or delete)
 * @param vaultPath - Absolute path to vault (used to compute relative node IDs)
 * @returns GraphDelta representing the state change
 *
 * @example
 * ```typescript
 * const fsUpdate: FSUpdate = { absolutePath: '/vault/note.md', content: '# Title', eventType: 'Added' }
 * const delta = mapFSEventsToGraphDelta(fsUpdate, '/vault')
 * // delta = [{ type: 'UpsertNode', nodeToUpsert: {...} }]
 * ```
 */
export function mapFSEventsToGraphDelta(fsEvent: FSEvent, vaultPath: string): GraphDelta {
  // Check if this is an FSUpdate (has content property) or FSDelete
  if ('content' in fsEvent) {
    // This is FSUpdate
    const fsUpdate = fsEvent as FSUpdate

    if (fsUpdate.eventType === 'Deleted') {
      // Delete event
      const nodeId = extractNodeIdFromPath(fsUpdate.absolutePath, vaultPath)
      const deleteAction: DeleteNode = {
        type: 'DeleteNode',
        nodeId
      }
      return [deleteAction]
    } else {
      // Added or Changed - both are treated as upserts
      return handleUpsert(fsUpdate, vaultPath)
    }
  } else {
    // This is FSDelete
    const nodeId = extractNodeIdFromPath(fsEvent.absolutePath, vaultPath)
    const deleteAction: DeleteNode = {
      type: 'DeleteNode',
      nodeId
    }
    return [deleteAction]
  }
}

/**
 * Handle add/change events by creating an upsert action.
 */
function handleUpsert(fsUpdate: FSUpdate, vaultPath: string): GraphDelta {
  const nodeId = extractNodeIdFromPath(fsUpdate.absolutePath, vaultPath)

  // Create base node from file content
  const baseNode: GraphNode = {
    relativeFilePathIsID: nodeId,
    content: fsUpdate.content,
    outgoingEdges: [],
    nodeUIMetadata: {
      color: O.none,
      position: O.none // Position will be calculated by layout algorithm
    }
  }

  // Set edges from wikilinks using centralized edge operation
  const node = setOutgoingEdges(baseNode, parseLinksFromContent(fsUpdate.content))

  const upsertAction: UpsertNodeAction = {
    type: 'UpsertNode',
    nodeToUpsert: node
  }

  return [upsertAction]
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
function extractNodeIdFromPath(filePath: string, vaultPath: string): NodeId {
  // Normalize paths to handle trailing slashes
  const normalizedVault = vaultPath.endsWith('/') ? vaultPath : vaultPath + '/'

  // Get relative absolutePath from vault
  const relativePath = filePath.startsWith(normalizedVault)
    ? filePath.substring(normalizedVault.length)
    : path.basename(filePath) // Fallback to basename if not under vault

  // Convert to node ID (remove .md extension)
  return filenameToNodeId(relativePath)
}

/**
 * Parse markdown links from content to extract outgoing edges.
 * E.g., "[[OtherNote]]" -> ["OtherNote"]
 */
function parseLinksFromContent(content: string): readonly NodeId[] {
  const linkRegex = /\[\[([^\]]+)\]\]/g
  const matches = [...content.matchAll(linkRegex)]
  return matches.map((match) => match[1])
}
