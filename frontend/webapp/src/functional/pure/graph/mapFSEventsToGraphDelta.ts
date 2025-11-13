import type {FSEvent, GraphDelta, DeleteNode, UpsertNodeAction, GraphNode, NodeId, FSUpdate, Graph} from '@/functional/pure/graph/types.ts'
import path from 'path'
import { filenameToNodeId } from '@/functional/pure/graph/markdown-parsing/filename-utils.ts'
import { setOutgoingEdges } from '@/functional/pure/graph/graph-operations /graph-edge-operations.ts'
import { extractLinkedNodeIds } from '@/functional/pure/graph/markdown-parsing/extract-linked-node-ids.ts'
import { parseMarkdownToGraphNode } from '@/functional/pure/graph/markdown-parsing/parse-markdown-to-node.ts'

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
      return handleUpsert(fsUpdate, vaultPath, currentGraph)
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
function handleUpsert(fsUpdate: FSUpdate, vaultPath: string, currentGraph: Graph): GraphDelta {
  const nodeId = extractNodeIdFromPath(fsUpdate.absolutePath, vaultPath)
  const filename = path.basename(fsUpdate.absolutePath)

  // Parse markdown to node, which extracts frontmatter (color, position, etc.)
  const baseNode = parseMarkdownToGraphNode(fsUpdate.content, filename)

  // Ensure the node ID matches the path-derived ID (in case frontmatter has different node_id)
  const nodeWithCorrectId: GraphNode = {
    ...baseNode,
    relativeFilePathIsID: nodeId
  }

  // Set edges from wikilinks using extractLinkedNodeIds (same as initial load)
  // This ensures consistent normalization (.md stripping, ./ prefix handling, etc.)
  const node = setOutgoingEdges(nodeWithCorrectId, extractLinkedNodeIds(fsUpdate.content, currentGraph.nodes))

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
