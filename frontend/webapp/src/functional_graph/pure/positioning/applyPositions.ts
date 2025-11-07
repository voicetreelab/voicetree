
// FUNCTION, TAKES GRAPH, APPLIES calculateInitialPosition to EVERY NODE if position is none, returns GRAPH

// DOES a PREORDER TRAVERSAL STARTING FROM ALL ROOTS OF GRAPH (NODE WITH NO PARENT)

// pre order to ensure parents already have position set before positioning children

// mimick A GHOST ROOT NODE FOR THE INITIAL ROOTS, TO MIMICK AS IF THE ROOT NODES ALL HAVE A COMMON PARENT for positioning

// uses src/functional_graph/pure/positioning/calculateInitialPosition.ts

// SEEN SET TO AVOID CYCLES

import type { Graph, NodeId, Position } from '@/functional_graph/pure/types.ts'
import * as O from 'fp-ts/lib/Option.js'
import { calculateInitialPositionForChild } from './calculateInitialPosition.ts'
import { findFirstParentNode } from '@/functional_graph/pure/findFirstParentNode.ts'

const GHOST_ROOT_POSITION: Position = { x: 0, y: 0 }
const ROOT_SPREAD_ANGLE = Math.PI * 2 // Full circle for root nodes
const ROOT_SPAWN_RADIUS = 200 // Distance from origin for root nodes

/**
 * Apply positions to all nodes in the graph that don't have a position.
 *
 * Algorithm:
 * 1. Find all root nodes (nodes with no parent)
 * 2. Position root nodes in a circle around origin (mimicking a ghost root at origin)
 * 3. Preorder traversal from each root to position children
 * 4. Uses a seen set to avoid cycles
 *
 * @param graph - The graph to apply positions to
 * @returns A new graph with all nodes positioned
 */
export function applyPositions(graph: Graph): Graph {
    const rootNodes = findRootNodes(graph)

    // Position root nodes in a circle around the ghost root at origin
    const graphWithRootPositions = positionRootNodes(graph, rootNodes)

    // Preorder traversal from each root
    const graphWithAllPositions = rootNodes.reduce(
        (accGraph, rootId) => traverseAndPosition(accGraph, rootId, new Set<NodeId>()).graph,
        graphWithRootPositions
    )

    return graphWithAllPositions
}

/**
 * Find all root nodes (nodes with no parent)
 */
function findRootNodes(graph: Graph): readonly NodeId[] {
    return Object.values(graph.nodes)
        .filter((node) => findFirstParentNode(node, graph) === undefined)
        .map((node) => node.relativeFilePathIsID)
}

/**
 * Position root nodes in a circle around the origin (ghost root)
 */
function positionRootNodes(graph: Graph, rootIds: readonly NodeId[]): Graph {
    if (rootIds.length === 0) {
        return graph
    }

    const updatedNodes = rootIds.reduce((nodes, rootId, index) => {
        const node = nodes[rootId]
        if (!node) return nodes

        // Skip if already has a position
        if (O.isSome(node.nodeUIMetadata.position)) {
            return nodes
        }

        // Calculate angle for this root node
        const angle = (index / rootIds.length) * ROOT_SPREAD_ANGLE

        // Position in circle around origin
        const position: Position = {
            x: GHOST_ROOT_POSITION.x + Math.cos(angle) * ROOT_SPAWN_RADIUS,
            y: GHOST_ROOT_POSITION.y + Math.sin(angle) * ROOT_SPAWN_RADIUS
        }

        return {
            ...nodes,
            [rootId]: {
                ...node,
                nodeUIMetadata: {
                    ...node.nodeUIMetadata,
                    position: O.some(position)
                }
            }
        }
    }, graph.nodes)

    return { nodes: updatedNodes }
}

/**
 * Preorder traversal to position nodes
 * Returns both the updated graph and the updated seen set
 */
function traverseAndPosition(
    graph: Graph,
    nodeId: NodeId,
    seen: Set<NodeId>
): { readonly graph: Graph; readonly seen: Set<NodeId> } {
    // Check for cycles
    if (seen.has(nodeId)) {
        return { graph, seen }
    }

    const newSeen = new Set(seen).add(nodeId)

    const node = graph.nodes[nodeId]
    if (!node) {
        return { graph, seen: newSeen }
    }

    // Position children using reduce (preorder: visit node before children)
    const result = node.outgoingEdges.reduce(
        (acc, childId) => {
            const childNode = acc.graph.nodes[childId]
            if (!childNode) return acc

            // If child doesn't have a position, calculate and set one
            const graphWithPosition = O.isNone(childNode.nodeUIMetadata.position)
                ? (() => {
                    const calculatedPosition = calculateInitialPositionForChild(node, acc.graph)

                    // Only apply if calculation succeeded (parent had position)
                    return O.isSome(calculatedPosition)
                        ? {
                            nodes: {
                                ...acc.graph.nodes,
                                [childId]: {
                                    ...childNode,
                                    nodeUIMetadata: {
                                        ...childNode.nodeUIMetadata,
                                        position: calculatedPosition
                                    }
                                }
                            }
                        }
                        : acc.graph
                })()
                : acc.graph

            // Recurse to children
            return traverseAndPosition(graphWithPosition, childId, acc.seen)
        },
        { graph, seen: newSeen }
    )

    return result
}
