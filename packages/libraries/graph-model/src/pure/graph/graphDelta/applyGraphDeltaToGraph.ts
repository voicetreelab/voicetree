import type {Edge, Graph, GraphDelta, GraphNode, UpsertNodeDelta} from '..'
import { updateIndexForUpsert, updateIndexForDelete } from '../graph-operations/indexes/incomingEdgesIndex'
import type { IncomingEdgesIndex } from '../graph-operations/indexes/incomingEdgesIndex'
import {
  updateNodeByBaseNameIndexForUpsert,
  updateNodeByBaseNameIndexForDelete,
  updateUnresolvedLinksIndexForUpsert,
  updateUnresolvedLinksIndexForDelete
} from '../graph-operations/indexes/linkResolutionIndexes'
import type { NodeByBaseNameIndex, UnresolvedLinksIndex } from '../graph-operations/indexes/linkResolutionIndexes'
import * as O from 'fp-ts/lib/Option.js'

function sameEdge(left: Edge, right: Edge): boolean {
    return left.targetId === right.targetId && left.label === right.label
}

function containsEdge(edges: readonly Edge[], edge: Edge): boolean {
    return edges.some(candidate => sameEdge(candidate, edge))
}

function isEdgeAdditionOnly(previousEdges: readonly Edge[], nextEdges: readonly Edge[]): boolean {
    return previousEdges.every(edge => containsEdge(nextEdges, edge))
        && nextEdges.some(edge => !containsEdge(previousEdges, edge))
}

function mergeAddedEdges(
    currentEdges: readonly Edge[],
    previousEdges: readonly Edge[],
    nextEdges: readonly Edge[],
): readonly Edge[] {
    const addedEdges: readonly Edge[] = nextEdges.filter(edge => !containsEdge(previousEdges, edge))
    return [
        ...currentEdges,
        ...addedEdges.filter(edge => !containsEdge(currentEdges, edge)),
    ]
}

function rebaseStaleEdgeAdditionDelta(graph: Graph, nodeDelta: UpsertNodeDelta): UpsertNodeDelta {
    if (O.isNone(nodeDelta.previousNode)) {
        return nodeDelta
    }

    const previousNode: GraphNode = nodeDelta.previousNode.value
    const nextNode: GraphNode = nodeDelta.nodeToUpsert
    const existingNode: GraphNode | undefined = graph.nodes[nextNode.absoluteFilePathIsID]

    if (!existingNode || previousNode.absoluteFilePathIsID !== nextNode.absoluteFilePathIsID) {
        return nodeDelta
    }

    const deltaContentUnchanged: boolean =
        nextNode.contentWithoutYamlOrLinks === previousNode.contentWithoutYamlOrLinks
    const currentContentChanged: boolean =
        existingNode.contentWithoutYamlOrLinks !== previousNode.contentWithoutYamlOrLinks
    const onlyAddsEdges: boolean = isEdgeAdditionOnly(previousNode.outgoingEdges, nextNode.outgoingEdges)

    if (!deltaContentUnchanged || !currentContentChanged || !onlyAddsEdges) {
        return nodeDelta
    }

    return {
        ...nodeDelta,
        nodeToUpsert: {
            ...nextNode,
            contentWithoutYamlOrLinks: existingNode.contentWithoutYamlOrLinks,
            outgoingEdges: mergeAddedEdges(existingNode.outgoingEdges, previousNode.outgoingEdges, nextNode.outgoingEdges),
            nodeUIMetadata: existingNode.nodeUIMetadata,
        },
    }
}

export function rebaseStaleEdgeAdditionDeltas(graph: Graph, delta: GraphDelta): GraphDelta {
    return delta.map(nodeDelta => (
        nodeDelta.type === 'UpsertNode'
            ? rebaseStaleEdgeAdditionDelta(graph, nodeDelta)
            : nodeDelta
    ))
}

/**
 * Apply a GraphDelta to a Graph, producing a new Graph.
 *
 * Pure function: same input -> same output, no side effects
 *
 * Handles:
 * - UpsertNode: Creates new node or updates existing node
 * - DeleteNode: Simply removes the node from the graph
 *
 * Note: UI delete uses deleteNodeSimple which just removes the node
 * and cleans up parent edges (no transitive edge healing).
 *
 * @param graph - The current graph state
 * @param delta - The delta to apply
 * @returns A new Graph with the delta applied
 *
 * @example
 * ```typescript
 * const graph: Graph = { nodes: { 'note1': {...} }, incomingEdgesIndex: new Map() }
 * const delta: GraphDelta = [{ type: 'UpsertNode', nodeToUpsert: {...} }]
 * const newGraph = applyGraphDeltaToGraph(graph, delta)
 * ```
 */
export function applyGraphDeltaToGraph(graph: Graph, delta: GraphDelta): Graph {
    // Process each node delta sequentially
    return delta.reduce<Graph>((currentGraph, nodeDelta) => {
        if (nodeDelta.type === 'UpsertNode') {
            // Upsert node: add new or update existing
            const existingNode: GraphNode | undefined = currentGraph.nodes[nodeDelta.nodeToUpsert.absoluteFilePathIsID]
            const rebasedDelta: UpsertNodeDelta = rebaseStaleEdgeAdditionDelta(currentGraph, nodeDelta)
            const newNode: GraphNode = rebasedDelta.nodeToUpsert

            // Position preservation: positions are stored in .voicetree/positions.json, not YAML. //human
            // When FS events re-parse a node, the parsed node has no position (O.none).
            // This merge keeps the in-memory position (loaded from positions.json at startup).
            const mergedNode: GraphNode = (existingNode && O.isSome(existingNode.nodeUIMetadata.position) && O.isNone(newNode.nodeUIMetadata.position))
                ? { ...newNode, nodeUIMetadata: { ...newNode.nodeUIMetadata, position: existingNode.nodeUIMetadata.position } }
                : newNode

            const previousNode: O.Option<GraphNode> = existingNode ? O.some(existingNode) : O.none

            // Build new nodes record
            const newNodes: Record<string, GraphNode> = {
                ...currentGraph.nodes,
                [mergedNode.absoluteFilePathIsID]: mergedNode
            }

            // Update all indexes
            const newIncomingEdgesIndex: IncomingEdgesIndex = updateIndexForUpsert(currentGraph.incomingEdgesIndex, mergedNode, previousNode)
            const newNodeByBaseName: NodeByBaseNameIndex = updateNodeByBaseNameIndexForUpsert(currentGraph.nodeByBaseName, mergedNode, previousNode)
            const newUnresolvedLinksIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForUpsert(currentGraph.unresolvedLinksIndex, mergedNode, previousNode, newNodes)

            return {
                nodes: newNodes,
                incomingEdgesIndex: newIncomingEdgesIndex,
                nodeByBaseName: newNodeByBaseName,
                unresolvedLinksIndex: newUnresolvedLinksIndex
            }
        } else if (nodeDelta.type === 'DeleteNode') {
            // Simple delete - just remove the node
            const { [nodeDelta.nodeId]: deletedNode, ...remaining } = currentGraph.nodes

            if (!deletedNode) {
                return currentGraph
            }

            // Update all indexes
            const newIncomingEdgesIndex: IncomingEdgesIndex = updateIndexForDelete(currentGraph.incomingEdgesIndex, deletedNode)
            const newNodeByBaseName: NodeByBaseNameIndex = updateNodeByBaseNameIndexForDelete(currentGraph.nodeByBaseName, deletedNode)
            const newUnresolvedLinksIndex: UnresolvedLinksIndex = updateUnresolvedLinksIndexForDelete(currentGraph.unresolvedLinksIndex, deletedNode, remaining)

            return {
                nodes: remaining,
                incomingEdgesIndex: newIncomingEdgesIndex,
                nodeByBaseName: newNodeByBaseName,
                unresolvedLinksIndex: newUnresolvedLinksIndex
            }
        }

        // Should never reach here due to TypeScript exhaustiveness checking
        return currentGraph
    }, graph)
}

// export default applyGraphDeltaToGraph
