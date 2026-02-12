/**
 * Link resolution indexes for O(1) lookup during edge resolution and healing.
 *
 * Two indexes are maintained:
 * 1. nodeByBaseName - Maps lowercase basenames to node IDs for O(1) link resolution
 * 2. unresolvedLinksIndex - Maps unresolved link basenames to nodes with dangling edges for O(1) edge healing
 */

import type { GraphNode, NodeIdAndFilePath } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

export type NodeByBaseNameIndex = ReadonlyMap<string, readonly NodeIdAndFilePath[]>
export type UnresolvedLinksIndex = ReadonlyMap<string, readonly NodeIdAndFilePath[]>

/**
 * Extract the lowercase basename from a path.
 * Strips .md extension and normalizes to lowercase for consistent matching.
 *
 * @example
 * getBaseName('/vault/a/foo.md') => 'foo'
 * getBaseName('./foo.md') => 'foo'
 * getBaseName('FooBar.md') => 'foobar'
 */
export function getBaseName(path: string): string {
  const components: readonly string[] = path
    .split(/[/\\]/)
    .filter(p => p !== '' && p !== '.' && p !== '..')

  if (components.length === 0) return ''

  const lastComponent: string = components[components.length - 1]
  return lastComponent.replace(/\.md$/, '').toLowerCase()
}

/**
 * Mutable helper: add a nodeId to a basename entry in-place. O(1) via Map.get/set.
 * Operates on mutable Map copy — callers create the copy, this mutates it.
 */
function addToIndex(
  map: Map<string, NodeIdAndFilePath[]>,
  basename: string,
  nodeId: NodeIdAndFilePath
): void {
  if (basename === '') return

  const existing: NodeIdAndFilePath[] | undefined = map.get(basename)
  if (existing) {
    if (!existing.includes(nodeId)) existing.push(nodeId)
  } else {
    map.set(basename, [nodeId])
  }
}

/**
 * Mutable helper: remove a nodeId from a basename entry in-place. O(1) via Map.get/set/delete.
 * Operates on mutable Map copy — callers create the copy, this mutates it.
 */
function removeFromIndex(
  map: Map<string, NodeIdAndFilePath[]>,
  basename: string,
  nodeId: NodeIdAndFilePath
): void {
  if (basename === '') return

  const existing: NodeIdAndFilePath[] | undefined = map.get(basename)
  if (!existing) return

  const filtered: NodeIdAndFilePath[] = existing.filter(id => id !== nodeId)
  if (filtered.length === 0) {
    map.delete(basename)
  } else {
    map.set(basename, filtered)
  }
}

/**
 * Mutable helper: remove an entire basename key in-place. O(1) via Map.delete.
 */
function removeKey(
  map: Map<string, NodeIdAndFilePath[]>,
  basename: string
): void {
  if (basename === '') return
  map.delete(basename)
}

/**
 * Create a mutable deep copy of a ReadonlyMap index.
 * Each value array is shallow-copied so mutations don't affect the original.
 */
function mutableCopy(index: NodeByBaseNameIndex | UnresolvedLinksIndex | undefined): Map<string, NodeIdAndFilePath[]> {
  if (!index) return new Map()
  return new Map(Array.from(index.entries()).map(([k, v]) => [k, [...v]] as [string, NodeIdAndFilePath[]]))
}

/**
 * Build nodeByBaseName index: maps lowercase basename to all node IDs with that basename.
 *
 * @example
 * "foo" → ["/vault/a/foo.md", "/vault/b/foo.md"]
 */
export function buildNodeByBaseNameIndex(
  nodes: Record<NodeIdAndFilePath, GraphNode>
): NodeByBaseNameIndex {
  const map: Map<string, NodeIdAndFilePath[]> = new Map()

  Object.keys(nodes).forEach(nodeId => {
    addToIndex(map, getBaseName(nodeId), nodeId)
  })

  return map
}

/**
 * Build unresolvedLinksIndex: maps unresolved link basenames to nodes with those dangling edges.
 *
 * An edge is "unresolved" if its targetId doesn't exist in nodes.
 *
 * @example
 * "bar" → ["/vault/note1.md"] (note1 has [bar] but bar.md doesn't exist)
 */
export function buildUnresolvedLinksIndex(
  nodes: Record<NodeIdAndFilePath, GraphNode>
): UnresolvedLinksIndex {
  const map: Map<string, NodeIdAndFilePath[]> = new Map()

  Object.entries(nodes).forEach(([nodeId, node]) => {
    node.outgoingEdges
      .filter(edge => nodes[edge.targetId] === undefined)
      .forEach(edge => {
        addToIndex(map, getBaseName(edge.targetId), nodeId)
      })
  })

  return map
}

/**
 * Update nodeByBaseName index when a node is upserted.
 */
export function updateNodeByBaseNameIndexForUpsert(
  index: NodeByBaseNameIndex,
  node: GraphNode,
  previousNode: O.Option<GraphNode>
): NodeByBaseNameIndex {
  const nodeId: NodeIdAndFilePath = node.absoluteFilePathIsID
  const newBasename: string = getBaseName(nodeId)

  const map: Map<string, NodeIdAndFilePath[]> = mutableCopy(index)

  // If update, remove old entry if basename changed
  if (O.isSome(previousNode)) {
    const oldBasename: string = getBaseName(previousNode.value.absoluteFilePathIsID)
    if (oldBasename !== newBasename && oldBasename !== '') {
      removeFromIndex(map, oldBasename, previousNode.value.absoluteFilePathIsID)
    }
  }

  // Add new entry
  addToIndex(map, newBasename, nodeId)

  return map
}

/**
 * Update nodeByBaseName index when a node is deleted.
 */
export function updateNodeByBaseNameIndexForDelete(
  index: NodeByBaseNameIndex,
  deletedNode: GraphNode
): NodeByBaseNameIndex {
  const deletedNodeId: NodeIdAndFilePath = deletedNode.absoluteFilePathIsID
  const basename: string = getBaseName(deletedNodeId)

  if (!index) return new Map()
  if (basename === '') return index

  const map: Map<string, NodeIdAndFilePath[]> = mutableCopy(index)
  removeFromIndex(map, basename, deletedNodeId)

  return map
}

/**
 * Update unresolvedLinksIndex when a node is upserted.
 *
 * This handles:
 * 1. Removing entries where this new node resolves a dangling link
 * 2. Adding new unresolved links from this node's edges
 * 3. Removing old unresolved links if this is an update
 */
export function updateUnresolvedLinksIndexForUpsert(
  index: UnresolvedLinksIndex,
  node: GraphNode,
  previousNode: O.Option<GraphNode>,
  allNodes: Record<NodeIdAndFilePath, GraphNode>
): UnresolvedLinksIndex {
  const nodeId: NodeIdAndFilePath = node.absoluteFilePathIsID
  const nodeBasename: string = getBaseName(nodeId)

  const map: Map<string, NodeIdAndFilePath[]> = mutableCopy(index)

  // Step 1: If this is an update, remove old unresolved links from this node
  if (O.isSome(previousNode)) {
    previousNode.value.outgoingEdges.forEach(edge => {
      removeFromIndex(map, getBaseName(edge.targetId), previousNode.value.absoluteFilePathIsID)
    })
  }

  // Step 2: Remove entries where this new node resolves the dangling link
  removeKey(map, nodeBasename)

  // Step 3: Add new unresolved links from this node's edges
  node.outgoingEdges
    .filter(edge => allNodes[edge.targetId] === undefined)
    .forEach(edge => {
      addToIndex(map, getBaseName(edge.targetId), nodeId)
    })

  return map
}

/**
 * Update unresolvedLinksIndex when a node is deleted.
 *
 * This handles:
 * 1. Removing this node from any unresolved link entries
 * 2. Adding back unresolved entries for nodes that pointed to the deleted node
 */
export function updateUnresolvedLinksIndexForDelete(
  index: UnresolvedLinksIndex,
  deletedNode: GraphNode,
  allNodes: Record<NodeIdAndFilePath, GraphNode>
): UnresolvedLinksIndex {
  const deletedNodeId: NodeIdAndFilePath = deletedNode.absoluteFilePathIsID
  const deletedBasename: string = getBaseName(deletedNodeId)

  const map: Map<string, NodeIdAndFilePath[]> = mutableCopy(index)

  // Step 1: Remove deleted node from any unresolved link tracking
  deletedNode.outgoingEdges.forEach(edge => {
    removeFromIndex(map, getBaseName(edge.targetId), deletedNodeId)
  })

  // Step 2: Find nodes that have edges pointing to the deleted node
  // Their edges are now unresolved
  if (deletedBasename === '') {
    return map
  }

  Object.entries(allNodes)
    .filter(([, n]) => n.outgoingEdges.some(e => e.targetId === deletedNodeId))
    .forEach(([id]) => {
      addToIndex(map, deletedBasename, id)
    })

  return map
}
