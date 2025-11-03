import { Graph, FSUpdate, UIIO, GraphNode, NodeId } from './types'
import * as O from 'fp-ts/Option'
import path from 'path'

/**
 * Apply filesystem updates to the graph
 *
 * Function signature: BroadcastFn -> Graph -> FSUpdate -> (Graph, UIIO ())
 *
 * Takes a broadcast function (curried), then a graph and a filesystem update event,
 * returns the updated graph AND a UI effect to broadcast changes.
 *
 * This is a pure function - it doesn't modify the input graph, but returns
 * a new graph with the updates applied.
 *
 * @param broadcast - Function to broadcast graph state to renderer
 * @returns Function that takes graph and update, returns [updated graph, UI broadcast effect]
 */
export function apply_db_updates_to_graph(broadcast: (graph: Graph) => void) {
  return (graph: Graph, update: FSUpdate): readonly [Graph, UIIO<void>] => {
    switch (update.eventType) {
      case 'Added':
        return handleAdded(broadcast)(graph, update)
      case 'Changed':
        return handleChanged(broadcast)(graph, update)
      case 'Deleted':
        return handleDeleted(broadcast)(graph, update)
    }
  }
}

/**
 * Handle 'Added' filesystem event
 *
 * Parses the file content and adds a new node to the graph.
 */
function handleAdded(broadcast: (graph: Graph) => void) {
  return (graph: Graph, update: FSUpdate): readonly [Graph, UIIO<void>] => {
    const nodeId = extractNodeIdFromPath(update.path)

    // If node already exists, treat as update instead
    if (graph.nodes[nodeId]) {
      return handleChanged(broadcast)(graph, update)
    }

    // Create new GraphNode from file content
    const newNode: GraphNode = {
      id: nodeId,
      title: extractTitle(update.content),
      content: update.content,
      summary: '', // TODO: Generate summary in Phase 3
      color: O.none
    }

    // Parse edges from markdown links
    const edges = parseLinksFromContent(update.content)

    const updatedGraph: Graph = {
      nodes: {
        ...graph.nodes,
        [nodeId]: newNode
      },
      edges: {
        ...graph.edges,
        [nodeId]: edges
      }
    }

    // Create UI effect to broadcast updated graph to renderer
    const uiEffect: UIIO<void> = () => {
      broadcast(updatedGraph)
    }

    return [updatedGraph, uiEffect]
  }
}

/**
 * Handle 'Changed' filesystem event
 *
 * Updates an existing node with new content from the filesystem.
 */
function handleChanged(broadcast: (graph: Graph) => void) {
  return (graph: Graph, update: FSUpdate): readonly [Graph, UIIO<void>] => {
    const nodeId = extractNodeIdFromPath(update.path)
    const existingNode = graph.nodes[nodeId]

    if (!existingNode) {
      // Node doesn't exist yet - treat as addition
      return handleAdded(broadcast)(graph, update)
    }

    // Update node with new content
    const updatedNode: GraphNode = {
      ...existingNode,
      title: extractTitle(update.content),
      content: update.content
      // TODO: Update summary in Phase 3
    }

    // Parse edges from markdown links
    const edges = parseLinksFromContent(update.content)

    const updatedGraph: Graph = {
      nodes: {
        ...graph.nodes,
        [nodeId]: updatedNode
      },
      edges: {
        ...graph.edges,
        [nodeId]: edges
      }
    }

    // Create UI effect to broadcast updated graph to renderer
    const uiEffect: UIIO<void> = () => {
      broadcast(updatedGraph)
    }

    return [updatedGraph, uiEffect]
  }
}

/**
 * Handle 'Deleted' filesystem event
 *
 * Removes a node from the graph when its file is deleted.
 */
function handleDeleted(broadcast: (graph: Graph) => void) {
  return (graph: Graph, update: FSUpdate): readonly [Graph, UIIO<void>] => {
    const nodeId = extractNodeIdFromPath(update.path)

    // Remove node from graph
    const { [nodeId]: _removed, ...remainingNodes } = graph.nodes

    // Remove edges connected to this node
    const updatedEdges = { ...graph.edges }
    delete updatedEdges[nodeId]

    // Also remove any edges that reference this node as a target
    Object.keys(updatedEdges).forEach((id) => {
      updatedEdges[id] = updatedEdges[id].filter((targetId) => targetId !== nodeId)
    })

    const updatedGraph: Graph = {
      nodes: remainingNodes,
      edges: updatedEdges
    }

    // Create UI effect to broadcast updated graph to renderer
    const uiEffect: UIIO<void> = () => {
      broadcast(updatedGraph)
    }

    return [updatedGraph, uiEffect]
  }
}

/**
 * Extract node ID from file path.
 * E.g., "/path/to/vault/MyNote.md" -> "MyNote"
 */
function extractNodeIdFromPath(filePath: string): NodeId {
  const basename = path.basename(filePath, '.md')
  return basename
}

/**
 * Extract title from markdown content.
 */
function extractTitle(content: string): string {
  const lines = content.split('\n')
  const firstLine = lines[0] || ''

  if (firstLine.startsWith('# ')) {
    return firstLine.substring(2).trim()
  }

  return 'Untitled'
}

/**
 * Parse markdown links from content to extract edges.
 * E.g., "[[OtherNote]]" -> ["OtherNote"]
 */
function parseLinksFromContent(content: string): readonly NodeId[] {
  const linkRegex = /\[\[([^\]]+)\]\]/g
  const links: readonly NodeId[] = []
  let match: RegExpExecArray | null

  while ((match = linkRegex.exec(content)) !== null) {
    links.push(match[1])
  }

  return links
}
