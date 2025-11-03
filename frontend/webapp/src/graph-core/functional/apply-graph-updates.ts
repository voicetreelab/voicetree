import * as IO from 'fp-ts/IO'
import { Graph, NodeAction, DBIO, NodeId, GraphNode } from './types'
import * as O from 'fp-ts/Option'
import { promises as fs } from 'fs'
import path from 'path'

/**
 * Apply a user-initiated action to the graph.
 *
 * Function signature: VaultPath -> Graph -> NodeAction -> (Graph, DBIO ())
 *
 * Takes a vault path (curried), then a graph and a user action, returns the updated graph
 * AND a DB effect to persist the change. This follows the functional architecture where we
 * separate pure computation (graph update) from side effects (database persistence).
 *
 * @param vaultPath - Path to the vault directory for filesystem operations
 * @returns Function that takes graph and action, returns [updated graph, database effect]
 */
export function apply_graph_updates(vaultPath: string) {
  return (graph: Graph, action: NodeAction): readonly [Graph, DBIO] => {
    switch (action.type) {
      case 'CreateNode':
        return handleCreateNode(vaultPath)(graph, action)
      case 'UpdateNode':
        return handleUpdateNode(vaultPath)(graph, action)
      case 'DeleteNode':
        return handleDeleteNode(vaultPath)(graph, action)
    }
  }
}

/**
 * Handle CreateNode action.
 *
 * Creates a new GraphNode and returns a DB effect to persist it to filesystem.
 */
function handleCreateNode(vaultPath: string) {
  return (
    graph: Graph,
    action: Extract<NodeAction, { readonly type: 'CreateNode' }>
  ): readonly [Graph, DBIO] => {
    // Create a basic node structure
    const newNode: GraphNode = {
      id: action.nodeId,
      title: extractTitle(action.content),
      content: action.content,
      summary: '', // TODO: Generate summary in Phase 3
      color: O.none
    }

    const updatedGraph: Graph = {
      nodes: {
        ...graph.nodes,
        [action.nodeId]: newNode
      },
      edges: graph.edges
    }

    // Create DB effect to persist node to filesystem
    const dbEffect: DBIO = async () => {
      const filename = `${action.nodeId}.md`
      const filepath = path.join(vaultPath, filename)
      await fs.writeFile(filepath, action.content, 'utf-8')
    }

    return [updatedGraph, dbEffect]
  }
}

/**
 * Handle UpdateNode action.
 *
 * Updates an existing GraphNode and returns a DB effect to persist it to filesystem.
 */
function handleUpdateNode(vaultPath: string) {
  return (
    graph: Graph,
    action: Extract<NodeAction, { readonly type: 'UpdateNode' }>
  ): readonly [Graph, DBIO] => {
    const existingNode = graph.nodes[action.nodeId]

    if (!existingNode) {
      // Node doesn't exist - fail fast (no complex error handling per design philosophy)
      throw new Error(`Node ${action.nodeId} not found for update`)
    }

    // Update node with new content
    const updatedNode: GraphNode = {
      ...existingNode,
      title: extractTitle(action.content),
      content: action.content
      // TODO: Update summary in Phase 3
    }

    const updatedGraph: Graph = {
      nodes: {
        ...graph.nodes,
        [action.nodeId]: updatedNode
      },
      edges: graph.edges
    }

    // Create DB effect to persist update to filesystem
    const dbEffect: DBIO = async () => {
      const filename = `${action.nodeId}.md`
      const filepath = path.join(vaultPath, filename)
      await fs.writeFile(filepath, action.content, 'utf-8')
    }

    return [updatedGraph, dbEffect]
  }
}

/**
 * Handle DeleteNode action.
 *
 * Removes a GraphNode and returns a DB effect to delete it from filesystem.
 */
function handleDeleteNode(vaultPath: string) {
  return (
    graph: Graph,
    action: Extract<NodeAction, { readonly type: 'DeleteNode' }>
  ): readonly [Graph, DBIO] => {
    const { [action.nodeId]: _removed, ...remainingNodes } = graph.nodes

    // Remove edges connected to this node
    const updatedEdges = { ...graph.edges }
    delete updatedEdges[action.nodeId]

    // Also remove any edges that reference this node as a target
    Object.keys(updatedEdges).forEach((nodeId) => {
      updatedEdges[nodeId] = updatedEdges[nodeId].filter((targetId) => targetId !== action.nodeId)
    })

    const updatedGraph: Graph = {
      nodes: remainingNodes,
      edges: updatedEdges
    }

    // Create DB effect to delete file from filesystem
    const dbEffect: DBIO = async () => {
      const filename = `${action.nodeId}.md`
      const filepath = path.join(vaultPath, filename)
      await fs.unlink(filepath)
    }

    return [updatedGraph, dbEffect]
  }
}

/**
 * Extract title from markdown content.
 *
 * TODO: Implement proper title extraction from markdown
 */
function extractTitle(content: string): string {
  // STUB: Very basic title extraction
  const lines = content.split('\n')
  const firstLine = lines[0] || ''

  if (firstLine.startsWith('# ')) {
    return firstLine.substring(2).trim()
  }

  return 'Untitled'
}
