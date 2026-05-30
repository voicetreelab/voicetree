/**
 * Link resolution indexes for O(1) lookup during edge resolution and healing.
 *
 * Two indexes are maintained:
 * 1. nodeByBaseName - Maps lowercase basenames to node IDs for O(1) link resolution
 * 2. unresolvedLinksIndex - Maps unresolved link basenames to nodes with dangling edges for O(1) edge healing
 */

import type { GraphNode, NodeIdAndFilePath } from '../..'
import * as O from 'fp-ts/lib/Option.js'

export type NodeByBaseNameIndex = ReadonlyMap<string, readonly NodeIdAndFilePath[]>
export type UnresolvedLinksIndex = ReadonlyMap<string, readonly NodeIdAndFilePath[]>

/**
 * Extract the lowercase basename from a path.
 * Strips .md extension and normalizes to lowercase for consistent matching.
 *
 * @example
 * getBaseName('/project/a/foo.md') => 'foo'
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
 * Copy-on-write helper: add a nodeId to a basename entry by replacing its array. O(1) Map ops.
 * Never mutates an existing array in place, so the map may safely share value arrays with a
 * previous index (see mutableCopy). Operates on the caller's owned Map copy.
 */
function addToIndex(
  map: Map<string, readonly NodeIdAndFilePath[]>,
  basename: string,
  nodeId: NodeIdAndFilePath
): void {
  if (basename === '') return

  const existing: readonly NodeIdAndFilePath[] | undefined = map.get(basename)
  if (existing) {
    if (!existing.includes(nodeId)) map.set(basename, [...existing, nodeId])
  } else {
    map.set(basename, [nodeId])
  }
}

/**
 * Copy-on-write helper: remove a nodeId from a basename entry by replacing/deleting its array.
 * O(1) Map ops. Never mutates an existing array in place (filter allocates a new one).
 */
function removeFromIndex(
  map: Map<string, readonly NodeIdAndFilePath[]>,
  basename: string,
  nodeId: NodeIdAndFilePath
): void {
  if (basename === '') return

  const existing: readonly NodeIdAndFilePath[] | undefined = map.get(basename)
  if (!existing) return

  const filtered: readonly NodeIdAndFilePath[] = existing.filter(id => id !== nodeId)
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
  map: Map<string, readonly NodeIdAndFilePath[]>,
  basename: string
): void {
  if (basename === '') return
  map.delete(basename)
}

/**
 * Shallow-copy a ReadonlyMap index into a mutable Map. Value arrays are shared, not cloned:
 * every mutator (addToIndex/removeFromIndex/removeKey) replaces or deletes a whole entry rather
 * than mutating its array in place, so the original index is never affected. This avoids cloning
 * every value array on each delta (these updaters run on every node upsert/delete).
 * `index ?? []` keeps the prior behaviour of treating a missing index as empty.
 */
function mutableCopy(index: NodeByBaseNameIndex | UnresolvedLinksIndex | undefined): Map<string, readonly NodeIdAndFilePath[]> {
  return new Map(index ?? [])
}

/**
 * Build nodeByBaseName index: maps lowercase basename to all node IDs with that basename.
 *
 * @example
 * "foo" → ["/project/a/foo.md", "/project/b/foo.md"]
 */
export function buildNodeByBaseNameIndex(
  nodes: Record<NodeIdAndFilePath, GraphNode>
): NodeByBaseNameIndex {
  const map: Map<string, readonly NodeIdAndFilePath[]> = new Map()

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
 * "bar" → ["/project/note1.md"] (note1 has [bar] but bar.md doesn't exist)
 */
export function buildUnresolvedLinksIndex(
  nodes: Record<NodeIdAndFilePath, GraphNode>
): UnresolvedLinksIndex {
  const map: Map<string, readonly NodeIdAndFilePath[]> = new Map()

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

  const map: Map<string, readonly NodeIdAndFilePath[]> = mutableCopy(index)

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

  const map: Map<string, readonly NodeIdAndFilePath[]> = mutableCopy(index)
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

  const map: Map<string, readonly NodeIdAndFilePath[]> = mutableCopy(index)

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

  const map: Map<string, readonly NodeIdAndFilePath[]> = mutableCopy(index)

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
