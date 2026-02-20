/**
 * Shell helper: extract obstacle bounding boxes from cytoscape neighborhood.
 *
 * Bridges the cytoscape (shell) world with the pure findBestPosition algorithm.
 * Uses closedNeighborhood() × 3 for O(k) traversal, same pattern as anchor-to-node.ts.
 */

import type cytoscape from 'cytoscape';
import type { NodeIdAndFilePath } from '@/pure/graph';
import type { ObstacleBBox } from '@/pure/graph/positioning/findBestPosition';
import { boxObstacle, segmentObstacle } from '@/pure/graph/positioning/findBestPosition';
import type { Obstacle } from '@/pure/graph/positioning/findBestPosition';
import type { EdgeSegment } from '@/pure/graph/geometry';

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

/**
 * Extract edge line segments from the cytoscape neighborhood of a node.
 * Uses the same 5-hop neighborhood as obstacle extraction.
 * Returns segments for all edges in the neighborhood.
 */
export function extractEdgeSegmentsFromCytoscape(
    cy: cytoscape.Core,
    parentNodeId: NodeIdAndFilePath
): readonly EdgeSegment[] {
    const parentNode: cytoscape.CollectionReturnValue = cy.getElementById(parentNodeId);
    if (parentNode.length === 0) return [];

    const neighborhood: cytoscape.NodeCollection = parentNode
        .closedNeighborhood()
        .closedNeighborhood()
        .closedNeighborhood()
        .closedNeighborhood()
        .closedNeighborhood();

    return neighborhood
        .filter('edge')
        .map((edge: cytoscape.EdgeSingular): EdgeSegment => {
            const sourcePos: cytoscape.Position = edge.source().position();
            const targetPos: cytoscape.Position = edge.target().position();
            return {
                p1: { x: sourcePos.x, y: sourcePos.y },
                p2: { x: targetPos.x, y: targetPos.y },
            };
        });
}

/**
 * Extract a unified obstacle array (node bboxes + edge segments) from cytoscape.
 * Combines both obstacle types into one array for single-pass collision detection.
 */
export function extractAllObstaclesFromCytoscape(
    cy: cytoscape.Core,
    parentNodeId: NodeIdAndFilePath
): readonly Obstacle[] {
    const boxes: readonly Obstacle[] = extractObstaclesFromCytoscape(cy, parentNodeId).map(boxObstacle);
    const segments: readonly Obstacle[] = extractEdgeSegmentsFromCytoscape(cy, parentNodeId).map(segmentObstacle);
    return [...boxes, ...segments];
}
