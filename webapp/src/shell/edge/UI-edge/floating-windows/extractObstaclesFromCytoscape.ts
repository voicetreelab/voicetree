/**
 * Shell helper: extract obstacle bounding boxes from cytoscape neighborhood.
 *
 * Bridges the cytoscape (shell) world with the pure findBestPosition algorithm.
 * Uses closedNeighborhood() × 3 for O(k) traversal, same pattern as anchor-to-node.ts.
 */

import type cytoscape from 'cytoscape';
import type { Graph, NodeIdAndFilePath, Position, GraphNode } from '@/pure/graph';
import type { ObstacleBBox } from '@/pure/graph/positioning/findBestPosition';
import { findBestPosition } from '@/pure/graph/positioning/findBestPosition';
import { calculateChildAngle, calculateParentAngle, DEFAULT_EDGE_LENGTH } from '@/pure/graph/positioning/angularPositionSeeding';
import { findFirstParentNode } from '@/pure/graph/graph-operations/findFirstParentNode';

const CHILD_NODE_DIMENSIONS: { readonly width: number; readonly height: number } = { width: 150, height: 40 };

/**
 * Extract obstacle bounding boxes from the cytoscape neighborhood of a node.
 * Excludes the node itself from the obstacle set.
 */
export function extractObstaclesFromCytoscape(
    cy: cytoscape.Core,
    parentNodeId: NodeIdAndFilePath
): readonly ObstacleBBox[] {
    const parentNode: cytoscape.CollectionReturnValue = cy.getElementById(parentNodeId);
    if (parentNode.length === 0) return [];

    const nearbyNodes: cytoscape.NodeCollection = parentNode
        .closedNeighborhood()  // distance 1
        .closedNeighborhood()  // distance 2
        .closedNeighborhood()  // distance 3
        .filter('node');

    return nearbyNodes
        .filter((node: cytoscape.NodeSingular) => node.id() !== parentNodeId)
        .map((node: cytoscape.NodeSingular): ObstacleBBox => {
            const pos: cytoscape.Position = node.position();
            const w: number = node.width();
            const h: number = node.height();
            return {
                x1: pos.x - w / 2,
                x2: pos.x + w / 2,
                y1: pos.y - h / 2,
                y2: pos.y + h / 2,
            };
        });
}

/**
 * Calculate a collision-aware position for a new child node.
 *
 * Reads live positions from cytoscape, computes the desired angle from the pure graph,
 * extracts obstacles, and delegates to findBestPosition.
 */
export function calculateCollisionAwareChildPosition(
    cy: cytoscape.Core,
    parentNodeId: NodeIdAndFilePath,
    graph: Graph
): Position {
    const parentCyNode: cytoscape.CollectionReturnValue = cy.getElementById(parentNodeId);
    const parentPos: cytoscape.Position = parentCyNode.position();

    const parentGraphNode: GraphNode | undefined = graph.nodes[parentNodeId];
    const grandparentNode: GraphNode | undefined = parentGraphNode ? findFirstParentNode(parentGraphNode, graph) : undefined;
    const parentAngle: number | undefined = parentGraphNode && grandparentNode
        ? calculateParentAngle(parentGraphNode, grandparentNode)
        : undefined;

    const childIndex: number = parentGraphNode ? parentGraphNode.outgoingEdges.length : 0;
    const desiredAngle: number = calculateChildAngle(childIndex, parentAngle);

    const obstacles: readonly ObstacleBBox[] = extractObstaclesFromCytoscape(cy, parentNodeId);

    return findBestPosition(
        { x: parentPos.x, y: parentPos.y },
        desiredAngle,
        DEFAULT_EDGE_LENGTH,
        CHILD_NODE_DIMENSIONS,
        obstacles
    );
}
