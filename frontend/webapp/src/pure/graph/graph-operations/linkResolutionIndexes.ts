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
 * Immutable helper: add a nodeId to a basename entry, returning new map.
 */
function addToIndex(
  entries: readonly (readonly [string, readonly NodeIdAndFilePath[]])[],
  basename: string,
  nodeId: NodeIdAndFilePath
): readonly (readonly [string, readonly NodeIdAndFilePath[]])[] {
  if (basename === '') return entries

  const existingEntry: readonly [string, readonly NodeIdAndFilePath[]] | undefined =
    entries.find(([k]) => k === basename)

  if (existingEntry) {
    const [, existingList] = existingEntry
    if (existingList.includes(nodeId)) return entries
    return entries.map(([k, v]) =>
      k === basename ? [k, [...v, nodeId]] as const : [k, v] as const
    )
  }

  return [...entries, [basename, [nodeId]] as const]
}

/**
 * Immutable helper: remove a nodeId from a basename entry, returning new map.
 */
function removeFromIndex(
  entries: readonly (readonly [string, readonly NodeIdAndFilePath[]])[],
  basename: string,
  nodeId: NodeIdAndFilePath
): readonly (readonly [string, readonly NodeIdAndFilePath[]])[] {
  if (basename === '') return entries

  return entries
    .map(([k, v]) => {
      if (k !== basename) return [k, v] as const
      const filtered: readonly NodeIdAndFilePath[] = v.filter(id => id !== nodeId)
      return [k, filtered] as const
    })
    .filter(([, v]) => v.length > 0)
}

/**
 * Immutable helper: remove an entire basename key, returning new map.
 */
function removeKey(
  entries: readonly (readonly [string, readonly NodeIdAndFilePath[]])[],
  basename: string
): readonly (readonly [string, readonly NodeIdAndFilePath[]])[] {
  if (basename === '') return entries
  return entries.filter(([k]) => k !== basename)
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
  const nodeIds: readonly NodeIdAndFilePath[] = Object.keys(nodes)

  const entries: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] = nodeIds.reduce<
    readonly (readonly [string, readonly NodeIdAndFilePath[]])[]
  >(
    (acc, nodeId) => addToIndex(acc, getBaseName(nodeId), nodeId),
    []
  )

  return new Map(entries)
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
  const unresolvedPairs: readonly (readonly [string, NodeIdAndFilePath])[] =
    Object.entries(nodes).flatMap(([nodeId, node]) =>
      node.outgoingEdges
        .filter(edge => nodes[edge.targetId] === undefined)
        .map(edge => [getBaseName(edge.targetId), nodeId] as const)
    )

  const entries: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] = unresolvedPairs.reduce<
    readonly (readonly [string, readonly NodeIdAndFilePath[]])[]
  >(
    (acc, [basename, nodeId]) => addToIndex(acc, basename, nodeId),
    []
  )

  return new Map(entries)
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

  // Defensive: handle undefined index (can happen if graph was partially initialized)
  const initialEntries: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] =
    index ? Array.from(index.entries()) : []

  // If update, remove old entry if basename changed
  const afterRemoval: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] = O.isSome(previousNode)
    ? (() => {
        const oldBasename: string = getBaseName(previousNode.value.absoluteFilePathIsID)
        return oldBasename !== newBasename && oldBasename !== ''
          ? removeFromIndex(initialEntries, oldBasename, previousNode.value.absoluteFilePathIsID)
          : initialEntries
      })()
    : initialEntries

  // Add new entry
  const afterAddition: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] =
    addToIndex(afterRemoval, newBasename, nodeId)

  return new Map(afterAddition)
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

  // Defensive: handle undefined index
  if (!index) return new Map()
  if (basename === '') return index

  const entries: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] =
    Array.from(index.entries())

  const afterRemoval: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] =
    removeFromIndex(entries, basename, deletedNodeId)

  return new Map(afterRemoval)
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

  // Defensive: handle undefined index
  const initialEntries: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] =
    index ? Array.from(index.entries()) : []

  // Step 1: If this is an update, remove old unresolved links from this node
  const afterOldRemoval: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] = O.isSome(previousNode)
    ? previousNode.value.outgoingEdges.reduce<readonly (readonly [string, readonly NodeIdAndFilePath[]])[]>(
        (acc, edge) => removeFromIndex(acc, getBaseName(edge.targetId), previousNode.value.absoluteFilePathIsID),
        initialEntries
      )
    : initialEntries

  // Step 2: Remove entries where this new node resolves the dangling link
  const afterResolution: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] =
    removeKey(afterOldRemoval, nodeBasename)

  // Step 3: Add new unresolved links from this node's edges
  const unresolvedEdges: readonly { readonly targetId: string; readonly label: string }[] =
    node.outgoingEdges.filter(edge => allNodes[edge.targetId] === undefined)

  const afterAddition: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] =
    unresolvedEdges.reduce<readonly (readonly [string, readonly NodeIdAndFilePath[]])[]>(
      (acc, edge) => addToIndex(acc, getBaseName(edge.targetId), nodeId),
      afterResolution
    )

  return new Map(afterAddition)
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

  // Defensive: handle undefined index
  const initialEntries: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] =
    index ? Array.from(index.entries()) : []

  // Step 1: Remove deleted node from any unresolved link tracking
  const afterRemoval: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] =
    deletedNode.outgoingEdges.reduce<readonly (readonly [string, readonly NodeIdAndFilePath[]])[]>(
      (acc, edge) => removeFromIndex(acc, getBaseName(edge.targetId), deletedNodeId),
      initialEntries
    )

  // Step 2: Find nodes that have edges pointing to the deleted node
  // Their edges are now unresolved
  if (deletedBasename === '') {
    return new Map(afterRemoval)
  }

  const nodesPointingToDeleted: readonly NodeIdAndFilePath[] = Object.entries(allNodes)
    .filter(([, n]) => n.outgoingEdges.some(e => e.targetId === deletedNodeId))
    .map(([id]) => id)

  const afterAddition: readonly (readonly [string, readonly NodeIdAndFilePath[]])[] =
    nodesPointingToDeleted.reduce<readonly (readonly [string, readonly NodeIdAndFilePath[]])[]>(
      (acc, id) => addToIndex(acc, deletedBasename, id),
      afterRemoval
    )

  return new Map(afterAddition)
}
