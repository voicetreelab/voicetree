/**
 * Shell helper: extract obstacle bounding boxes from cytoscape neighborhood.
 *
 * Bridges the cytoscape (shell) world with the pure findBestPosition algorithm.
 * Uses closedNeighborhood() × 3 for O(k) traversal, same pattern as anchor-to-node.ts.
 */

import type cytoscape from 'cytoscape';
import type { NodeIdAndFilePath } from '@/pure/graph';
import type { ObstacleBBox } from '@/pure/graph/positioning/findBestPosition';

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
        .closedNeighborhood()  // distance 4
        .closedNeighborhood()  // distance 5
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
