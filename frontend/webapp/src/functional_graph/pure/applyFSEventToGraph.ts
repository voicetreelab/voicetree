import type {Graph, FSUpdate, EnvReader, Node, NodeId, Env} from '@/functional_graph/pure/types'
import * as O from 'fp-ts/lib/Option.js'
import path from 'path'
import { filenameToNodeId } from '@/functional_graph/pure/markdown_parsing/filename-utils'

/**
 * Apply filesystem updates to the graph.
 *
 * Function signature: Graph -> FSUpdate -> EnvReader<Graph>
 *
 * Reads broadcast function from environment instead of taking it as parameter.
 * Returns synchronous Reader effect.
 *
 * @returns Pure Reader effect that produces updated graph
 */
export function apply_db_updates_to_graph(
  graph: Graph,
  update: FSUpdate
): EnvReader<Graph> {
  // Reader effect: function that takes Env and returns Graph
  return (env: Env) => {
    switch (update.eventType) {
      case 'Added':
        return handleAdded(env, graph, update)
      case 'Changed':
        return handleChanged(env, graph, update)
      case 'Deleted':
        return handleDeleted(env, graph, update)
    }
  }
}

/**
 * Handle 'Added' filesystem event
 *
 * Parses the file content and adds a new node to the graph.
 */
function handleAdded(env: Env, graph: Graph, update: FSUpdate): Graph {
  const nodeId = extractNodeIdFromPath(update.path, env.vaultPath)

  // If node already exists, treat as update instead
  if (graph.nodes[nodeId]) {
    return handleChanged(env, graph, update)
  }

  // Create new Node from file content
  const newNode: Node = {
    idAndFilePath: nodeId,
    title: extractTitle(update.content),
    content: update.content,
    summary: '', // TODO: Generate summary in Phase 3
    color: O.none
  }

  // Parse outgoingEdges from markdown links
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

  return updatedGraph
}

/**
 * Handle 'Changed' filesystem event
 *
 * Updates an existing node with new content from the filesystem.
 */
function handleChanged(env: Env, graph: Graph, update: FSUpdate): Graph {
  const nodeId = extractNodeIdFromPath(update.path, env.vaultPath)
  const existingNode = graph.nodes[nodeId]

  if (!existingNode) {
    // Node doesn't exist yet - treat as addition
    return handleAdded(env, graph, update)
  }

  // Update node with new content
  const updatedNode: Node = {
    ...existingNode,
    title: extractTitle(update.content),
    content: update.content
    // TODO: Update summary in Phase 3
  }

  // Parse outgoingEdges from markdown links
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

  return updatedGraph
}

/**
 * Handle 'Deleted' filesystem event
 *
 * Removes a node from the graph when its file is deleted.
 */
function handleDeleted(env: Env, graph: Graph, update: FSUpdate): Graph {
  const nodeId = extractNodeIdFromPath(update.path, env.vaultPath)

  // Remove node from graph
  const remainingNodes = Object.fromEntries(
    Object.entries(graph.nodes).filter(([id]) => id !== nodeId)
  )

  // Remove outgoingEdges connected to this node
  const updatedEdges = Object.fromEntries(
    Object.entries(graph.edges)
      .filter(([id]) => id !== nodeId)
      .map(([id, targets]) => [id, targets.filter((targetId) => targetId !== nodeId)])
  )

  const updatedGraph: Graph = {
    nodes: remainingNodes,
    edges: updatedEdges
  }

  return updatedGraph
}

/**
 * Extract node ID from file path by computing relative path from vault.
 *
 * Pure function: same input -> same output, no side effects
 *
 * @param filePath - Absolute path to the file (e.g., "/path/to/vault/subfolder/MyNote.md")
 * @param vaultPath - Absolute path to the vault (e.g., "/path/to/vault")
 * @returns Node ID with relative path preserved (e.g., "subfolder/MyNote")
 *
 * @example
 * ```typescript
 * extractNodeIdFromPath("/vault/MyNote.md", "/vault")
 * // => "MyNote"
 *
 * extractNodeIdFromPath("/vault/subfolder/MyNote.md", "/vault")
 * // => "subfolder/MyNote"
 * ```
 */
function extractNodeIdFromPath(filePath: string, vaultPath: string): NodeId {
  // Normalize paths to handle trailing slashes
  const normalizedVault = vaultPath.endsWith('/') ? vaultPath : vaultPath + '/' // todo this should be made into a type
  // todo i.e. vaultPath: VaultPath, which must end in a / on toString ?

  // Get relative path from vault
  const relativePath = filePath.startsWith(normalizedVault)
    ? filePath.substring(normalizedVault.length)
    : path.basename(filePath) // Fallback to basename if not under vault

  // Convert to node ID (remove .md extension)
  return filenameToNodeId(relativePath)
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
 * Parse markdown links from content to extract outgoingEdges.
 * E.g., "[[OtherNote]]" -> ["OtherNote"]
 */
function parseLinksFromContent(content: string): readonly NodeId[] {
  const linkRegex = /\[\[([^\]]+)\]\]/g
  const matches = [...content.matchAll(linkRegex)]
  return matches.map((match) => match[1])
}
