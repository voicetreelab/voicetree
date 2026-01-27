/**
 * Incoming edges index utilities for O(1) lookup of nodes that reference a given node.
 *
 * This index maps each node ID to the list of node IDs that have outgoing edges to it.
 */

import type { GraphNode, NodeIdAndFilePath } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

export type IncomingEdgesIndex = ReadonlyMap<NodeIdAndFilePath, readonly NodeIdAndFilePath[]>

/**
 * Build an incoming edges index from a record of nodes.
 *
 * @param nodes - Record of all nodes in the graph
 * @returns Map from node ID to list of node IDs that reference it
 */
export function buildIncomingEdgesIndex(
  nodes: Record<NodeIdAndFilePath, GraphNode>
): IncomingEdgesIndex {
  // Collect all (targetId, sourceId) pairs from edges
  const allEdgePairs: readonly (readonly [NodeIdAndFilePath, NodeIdAndFilePath])[] =
    Object.entries(nodes).flatMap(([nodeId, node]) =>
      node.outgoingEdges.map(edge => [edge.targetId, nodeId] as const)
    )

  // Group by targetId to build the index
  return allEdgePairs.reduce<ReadonlyMap<NodeIdAndFilePath, readonly NodeIdAndFilePath[]>>(
    (acc, [targetId, sourceId]) => {
      const existingIncomers: readonly NodeIdAndFilePath[] = acc.get(targetId) ?? []
      acc.set(targetId, [...existingIncomers, sourceId])
      return acc
    },
    new Map()
  )
}

/**
 * Update the incoming edges index when a node is upserted.
 *
 * @param index - Current incoming edges index
 * @param node - The node being upserted
 * @param previousNode - The previous version of the node (None if new node)
 * @returns New index with updated references
 */
export function updateIndexForUpsert(
  index: IncomingEdgesIndex,
  node: GraphNode,
  previousNode: O.Option<GraphNode>
): IncomingEdgesIndex {
  const nodeId: NodeIdAndFilePath = node.absoluteFilePathIsID

  // Defensive: handle undefined index
  const indexEntries: readonly (readonly [NodeIdAndFilePath, readonly NodeIdAndFilePath[]])[] =
    index ? Array.from(index.entries()) : []

  // Step 1: Remove old references if this is an update
  const indexAfterRemovals: ReadonlyMap<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = O.isSome(previousNode)
    ? previousNode.value.outgoingEdges.reduce<ReadonlyMap<NodeIdAndFilePath, readonly NodeIdAndFilePath[]>>(
        (acc, edge) => {
          const targetId: NodeIdAndFilePath = edge.targetId
          const incomers: readonly NodeIdAndFilePath[] | undefined = acc.get(targetId)
          if (incomers) {
            const filtered: readonly NodeIdAndFilePath[] = incomers.filter(id => id !== nodeId)
            if (filtered.length === 0) {
              acc.delete(targetId)
            } else {
              acc.set(targetId, filtered)
            }
          }
          return acc
        },
        new Map(indexEntries.map(([k, v]) => [k, [...v]]))
      )
    : new Map(indexEntries.map(([k, v]) => [k, [...v]]))

  // Step 2: Add new references
  return node.outgoingEdges.reduce<ReadonlyMap<NodeIdAndFilePath, readonly NodeIdAndFilePath[]>>(
    (acc, edge) => {
      const targetId: NodeIdAndFilePath = edge.targetId
      const existingIncomers: readonly NodeIdAndFilePath[] = acc.get(targetId) ?? []
      if (!existingIncomers.includes(nodeId)) {
        acc.set(targetId, [...existingIncomers, nodeId])
      }
      return acc
    },
    indexAfterRemovals
  )
}

/**
 * Update the incoming edges index when a node is deleted.
 *
 * @param index - Current incoming edges index
 * @param deletedNode - The node being deleted
 * @returns New index with references removed
 */
export function updateIndexForDelete(
  index: IncomingEdgesIndex,
  deletedNode: GraphNode
): IncomingEdgesIndex {
  const deletedNodeId: NodeIdAndFilePath = deletedNode.absoluteFilePathIsID

  // Defensive: handle undefined index
  const indexEntries: readonly (readonly [NodeIdAndFilePath, readonly NodeIdAndFilePath[]])[] =
    index ? Array.from(index.entries()) : []

  // Step 1: Remove references from this node's outgoing edges
  const indexAfterEdgeRemovals: ReadonlyMap<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> =
    deletedNode.outgoingEdges.reduce<ReadonlyMap<NodeIdAndFilePath, readonly NodeIdAndFilePath[]>>(
      (acc, edge) => {
        const targetId: NodeIdAndFilePath = edge.targetId
        const incomers: readonly NodeIdAndFilePath[] | undefined = acc.get(targetId)
        if (incomers) {
          const filtered: readonly NodeIdAndFilePath[] = incomers.filter(id => id !== deletedNodeId)
          if (filtered.length === 0) {
            acc.delete(targetId)
          } else {
            acc.set(targetId, filtered)
          }
        }
        return acc
      },
      new Map(indexEntries.map(([k, v]) => [k, [...v]]))
    )

  // Step 2: Also remove the deleted node's own entry (nodes pointing to it)
  indexAfterEdgeRemovals.delete(deletedNodeId)

  return indexAfterEdgeRemovals
}
