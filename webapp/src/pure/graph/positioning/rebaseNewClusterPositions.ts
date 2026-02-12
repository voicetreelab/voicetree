import type { Graph, GraphNode, Position } from '@/pure/graph'
import * as O from 'fp-ts/lib/Option.js'

interface BBox {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
    readonly width: number
    readonly height: number
    readonly centroidX: number
    readonly centroidY: number
}

interface BBoxAccumulator {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
    readonly sumX: number
    readonly sumY: number
    readonly count: number
}

const INITIAL_BBOX_ACC: BBoxAccumulator = {
    minX: Infinity, minY: Infinity,
    maxX: -Infinity, maxY: -Infinity,
    sumX: 0, sumY: 0, count: 0,
}

/**
 * Compute bounding box and centroid from a list of positions.
 * Returns undefined if positions is empty.
 */
function computeBBox(positions: readonly Position[]): BBox | undefined {
    if (positions.length === 0) return undefined

    const acc: BBoxAccumulator = positions.reduce(
        (a: BBoxAccumulator, pos: Position): BBoxAccumulator => ({
            minX: Math.min(a.minX, pos.x),
            minY: Math.min(a.minY, pos.y),
            maxX: Math.max(a.maxX, pos.x),
            maxY: Math.max(a.maxY, pos.y),
            sumX: a.sumX + pos.x,
            sumY: a.sumY + pos.y,
            count: a.count + 1,
        }),
        INITIAL_BBOX_ACC,
    )

    return {
        minX: acc.minX,
        minY: acc.minY,
        maxX: acc.maxX,
        maxY: acc.maxY,
        width: acc.maxX - acc.minX,
        height: acc.maxY - acc.minY,
        centroidX: acc.sumX / acc.count,
        centroidY: acc.sumY / acc.count,
    }
}

/**
 * Collect positions for node IDs that have a saved position (O.isSome).
 */
function collectPositions(graph: Graph, nodeIds: readonly string[]): readonly Position[] {
    return nodeIds.reduce((acc: Position[], id: string): Position[] => {
        const node: GraphNode | undefined = graph.nodes[id]
        if (node && O.isSome(node.nodeUIMetadata.position)) {
            return [...acc, node.nodeUIMetadata.position.value]
        }
        return acc
    }, [])
}

/**
 * Get IDs of new nodes that have saved positions.
 */
function getPositionedNewNodeIds(graph: Graph, newNodeIds: readonly string[]): readonly string[] {
    return newNodeIds.filter((id: string): boolean => {
        const node: GraphNode | undefined = graph.nodes[id]
        return node !== undefined && O.isSome(node.nodeUIMetadata.position)
    })
}

/**
 * Update a node's position in a nodes record.
 */
function setNodePosition(
    nodes: Record<string, GraphNode>,
    id: string,
    newPos: Position
): Record<string, GraphNode> {
    const node: GraphNode = nodes[id]
    return {
        ...nodes,
        [id]: {
            ...node,
            nodeUIMetadata: {
                ...node.nodeUIMetadata,
                position: O.some(newPos),
            },
        },
    }
}

/**
 * Extract position from a node that is known to have one.
 */
function getPosition(nodes: Record<string, GraphNode>, id: string): Position {
    return (nodes[id].nodeUIMetadata.position as O.Some<Position>).value
}

/**
 * Collect positions from nodes record for given IDs.
 */
function collectPositionsFromNodes(
    nodes: Record<string, GraphNode>,
    ids: readonly string[]
): readonly Position[] {
    return ids.map((id: string): Position => getPosition(nodes, id))
}

const MAX_CLUSTER_DIMENSION: number = 10000
const MAX_CENTROID_DISTANCE: number = 5000
const ADJACENT_GAP: number = 500

/**
 * Phase 1: Scale down oversized cluster toward centroid.
 * Returns updated nodes and recomputed bbox, or original if no scaling needed.
 */
function applyScalePhase(
    nodes: Record<string, GraphNode>,
    positionedIds: readonly string[],
    bbox: BBox
): { readonly nodes: Record<string, GraphNode>; readonly bbox: BBox } {
    const maxDimension: number = Math.max(bbox.width, bbox.height)
    if (maxDimension <= MAX_CLUSTER_DIMENSION) {
        return { nodes, bbox }
    }

    const scaleFactor: number = MAX_CLUSTER_DIMENSION / maxDimension
    const centroidX: number = bbox.centroidX
    const centroidY: number = bbox.centroidY

    const scaledNodes: Record<string, GraphNode> = positionedIds.reduce(
        (acc: Record<string, GraphNode>, id: string): Record<string, GraphNode> => {
            const pos: Position = getPosition(acc, id)
            return setNodePosition(acc, id, {
                x: centroidX + (pos.x - centroidX) * scaleFactor,
                y: centroidY + (pos.y - centroidY) * scaleFactor,
            })
        },
        nodes,
    )

    const scaledBBox: BBox | undefined = computeBBox(
        collectPositionsFromNodes(scaledNodes, positionedIds)
    )

    // scaledBBox can't be undefined since positionedIds is non-empty, but guard anyway
    return scaledBBox
        ? { nodes: scaledNodes, bbox: scaledBBox }
        : { nodes, bbox }
}

/**
 * Phase 2: Translate distant cluster adjacent to existing nodes.
 * Returns updated nodes or original if clusters are close enough.
 */
function applyTranslatePhase(
    nodes: Record<string, GraphNode>,
    positionedIds: readonly string[],
    newBBox: BBox,
    existingBBox: BBox
): Record<string, GraphNode> {
    const dx: number = newBBox.centroidX - existingBBox.centroidX
    const dy: number = newBBox.centroidY - existingBBox.centroidY
    const centroidDistance: number = Math.sqrt(dx * dx + dy * dy)

    if (centroidDistance <= MAX_CENTROID_DISTANCE) {
        return nodes
    }

    const newHalfWidth: number = newBBox.width / 2
    const targetX: number = existingBBox.maxX + ADJACENT_GAP + newHalfWidth
    const targetY: number = existingBBox.centroidY

    const offsetX: number = targetX - newBBox.centroidX
    const offsetY: number = targetY - newBBox.centroidY

    return positionedIds.reduce(
        (acc: Record<string, GraphNode>, id: string): Record<string, GraphNode> => {
            const pos: Position = getPosition(acc, id)
            return setNodePosition(acc, id, {
                x: pos.x + offsetX,
                y: pos.y + offsetY,
            })
        },
        nodes,
    )
}

/**
 * Rebase new cluster positions relative to existing nodes.
 *
 * Pure function, no side effects, no cytoscape dependency.
 *
 * Two-phase algorithm:
 *   Phase 1 — Scale down oversized cluster:
 *     If new cluster bbox exceeds 10,000 in any dimension, scale toward centroid.
 *   Phase 2 — Translate distant cluster:
 *     If distance between existing centroid and new centroid > 5,000,
 *     place new cluster to the right of existing bbox with a 500px gap.
 *
 * Edge cases (returns graph unchanged):
 *   - No positioned new nodes → skip
 *   - No existing positioned nodes (first load) → skip
 *   - Clusters already close → skip phase 2
 *   - Cluster bbox already small → skip phase 1
 */
export function rebaseNewClusterPositions(
    graph: Graph,
    existingNodeIds: readonly string[],
    newNodeIds: readonly string[]
): Graph {
    const newPositions: readonly Position[] = collectPositions(graph, newNodeIds)
    if (newPositions.length === 0) return graph

    const existingPositions: readonly Position[] = collectPositions(graph, existingNodeIds)
    if (existingPositions.length === 0) return graph

    const existingBBox: BBox | undefined = computeBBox(existingPositions)
    if (!existingBBox) return graph

    const newBBox: BBox | undefined = computeBBox(newPositions)
    if (!newBBox) return graph

    const positionedNewNodeIds: readonly string[] = getPositionedNewNodeIds(graph, newNodeIds)

    // Phase 1: Scale down oversized cluster
    const afterScale: { readonly nodes: Record<string, GraphNode>; readonly bbox: BBox } =
        applyScalePhase(graph.nodes, positionedNewNodeIds, newBBox)

    // Phase 2: Translate distant cluster
    const finalNodes: Record<string, GraphNode> =
        applyTranslatePhase(afterScale.nodes, positionedNewNodeIds, afterScale.bbox, existingBBox)

    // If no changes were made, return original graph
    if (finalNodes === graph.nodes) return graph

    // Preserve all indexes since we only changed positions, not edges
    return {
        nodes: finalNodes,
        incomingEdgesIndex: graph.incomingEdgesIndex,
        nodeByBaseName: graph.nodeByBaseName,
        unresolvedLinksIndex: graph.unresolvedLinksIndex,
    }
}
