import type {Graph, NodeAction, FSWriteEffect, GraphNode, Env} from '@/functional_graph/pure/types'
import * as O from 'fp-ts/lib/Option.js'
import * as TE from 'fp-ts/lib/TaskEither.js'
import { promises as fs } from 'fs'
import path from 'path'

/**
 * Helper to convert unknown errors to Error type
 */
const toError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason))

/**
 * Apply a user-initiated action to the graph by writing to filesystem.
 *
 * Function signature: Graph -> NodeAction -> FSWriteEffect<Graph>
 *
 * This creates an effect that writes to the filesystem.
 * The returned graph is for validation/testing - IPC handlers should NOT use it to update state.
 * Graph state updates come from file watch handlers detecting the filesystem change.
 *
 * @returns Filesystem write effect that returns computed graph (but don't update state with it!)
 */
export function apply_graph_updates(
  graph: Graph,
  action: NodeAction
): FSWriteEffect<Graph> {
  switch (action.type) {
    case 'CreateNode':
      return handleCreateNode(graph, action)
    case 'UpdateNode':
      return handleUpdateNode(graph, action)
    case 'DeleteNode':
      return handleDeleteNode(graph, action)
  }
}

/**
 * Handle CreateNode action.
 *
 * Creates a new GraphNode and returns a filesystem write effect.
 */
function handleCreateNode(
  graph: Graph,
  action: Extract<NodeAction, { readonly type: 'CreateNode' }>
): FSWriteEffect<Graph> {
  // Create updated graph (pure computation)
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

  // Return Reader effect: function that takes Env and returns TaskEither
  return (env: Env) =>
    TE.tryCatch(
      async () => {
        const filename = `${action.nodeId}.md`
        const filepath = path.join(env.vaultPath, filename)
        await fs.writeFile(filepath, action.content, 'utf-8')
        return updatedGraph
      },
      toError
    )
}

/**
 * Handle UpdateNode action.
 *
 * Updates an existing GraphNode and returns a filesystem write effect.
 */
function handleUpdateNode(
  graph: Graph,
  action: Extract<NodeAction, { readonly type: 'UpdateNode' }>
): FSWriteEffect<Graph> {
  const existingNode = graph.nodes[action.nodeId]

  if (!existingNode) {
    // Node doesn't exist - fail fast (no complex error handling per design philosophy)
    throw new Error(`Node ${action.nodeId} not found for update`)
  }

  // Update node with new content (pure computation)
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

  // Return Reader effect: function that takes Env and returns TaskEither
  return (env: Env) =>
    TE.tryCatch(
      async () => {
        const filename = `${action.nodeId}.md`
        const filepath = path.join(env.vaultPath, filename)
        await fs.writeFile(filepath, action.content, 'utf-8')
        return updatedGraph
      },
      toError
    )
}

/**
 * Handle DeleteNode action.
 *
 * Removes a GraphNode and returns a filesystem write effect.
 */
function handleDeleteNode(
  graph: Graph,
  action: Extract<NodeAction, { readonly type: 'DeleteNode' }>
): FSWriteEffect<Graph> {
  // Remove node from graph (pure computation)
  const remainingNodes = Object.fromEntries(
    Object.entries(graph.nodes).filter(([id]) => id !== action.nodeId)
  )

  // Remove edges connected to this node
  const updatedEdges = Object.fromEntries(
    Object.entries(graph.edges)
      .filter(([id]) => id !== action.nodeId)
      .map(([id, targets]) => [id, targets.filter((targetId) => targetId !== action.nodeId)])
  )

  const updatedGraph: Graph = {
    nodes: remainingNodes,
    edges: updatedEdges
  }

  // Return Reader effect: function that takes Env and returns TaskEither
  return (env: Env) =>
    TE.tryCatch(
      async () => {
        const filename = `${action.nodeId}.md`
        const filepath = path.join(env.vaultPath, filename)
        await fs.unlink(filepath)
        return updatedGraph
      },
      toError
    )
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
