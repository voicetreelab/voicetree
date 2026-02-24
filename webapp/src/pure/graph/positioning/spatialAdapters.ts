/**
 * Adapter converters bridging the spatial index module (Rect) with
 * the positioning module (ObstacleBBox, EdgeSegment).
 *
 * Lives in the positioning module (consumer-side) so that:
 * - Spatial module stays generic (only knows Rect)
 * - Positioning module stays pure (no rbush import)
 * - Only these adapter functions know both vocabularies
 *
 * Dependency direction:
 *   spatialIndex.ts <--- spatialAdapters.ts ---> findBestPosition.ts
 *       (Rect)           (knows both)          (ObstacleBBox)
 */

import type { Rect, SpatialNodeEntry, SpatialEdgeEntry, SpatialIndex } from '@/pure/graph/spatial';
import { queryNodesInRect, queryEdgesInRect, createSpatialIndex } from '@/pure/graph/spatial';
import type { ObstacleBBox } from '@/pure/graph/positioning/findBestPosition';
import { boxObstacle, segmentObstacle } from '@/pure/graph/positioning/findBestPosition';
import type { Obstacle } from '@/pure/graph/positioning/findBestPosition';
import type { EdgeSegment } from '@/pure/graph/geometry';
import type { Graph, GraphNode, NodeIdAndFilePath, Position } from '@/pure/graph';
import * as O from 'fp-ts/lib/Option.js';

// ============================================================================
// Individual Converters
// ============================================================================

/** Convert a spatial node entry to a positioning ObstacleBBox. */
export function nodeEntryToObstacle(entry: SpatialNodeEntry): ObstacleBBox {
    return { x1: entry.minX, y1: entry.minY, x2: entry.maxX, y2: entry.maxY };
}

/** Convert a positioning ObstacleBBox to a spatial Rect. */
export function obstacleToRect(obs: ObstacleBBox): Rect {
    return { minX: obs.x1, minY: obs.y1, maxX: obs.x2, maxY: obs.y2 };
}

/** Convert a SpatialEdgeEntry to a positioning EdgeSegment. */
export function edgeEntryToSegment(entry: SpatialEdgeEntry): EdgeSegment {
    return { p1: { x: entry.x1, y: entry.y1 }, p2: { x: entry.x2, y: entry.y2 } };
}

// ============================================================================
// Search Rect Builders
// ============================================================================

/** Build a search rectangle centered on a position with a given radius. */
export function buildSearchRect(center: Position, radius: number): Rect {
    return {
        minX: center.x - radius,
        minY: center.y - radius,
        maxX: center.x + radius,
        maxY: center.y + radius,
    };
}

/** Expand a rectangle by a margin on all sides. */
export function expandRect(rect: Rect, margin: number): Rect {
    return {
        minX: rect.minX - margin,
        minY: rect.minY - margin,
        maxX: rect.maxX + margin,
        maxY: rect.maxY + margin,
    };
}

// ============================================================================
// Composite Query Helpers
// ============================================================================

/**
 * Query obstacle bounding boxes from a spatial index within a search area.
 * Optionally excludes a specific node (e.g., the parent being placed around).
 */
export function queryObstaclesFromIndex(
    index: SpatialIndex,
    searchRect: Rect,
    excludeNodeId?: string
): readonly ObstacleBBox[] {
    const entries: readonly SpatialNodeEntry[] = queryNodesInRect(index, searchRect);
    const filtered: readonly SpatialNodeEntry[] = excludeNodeId
        ? entries.filter((e: SpatialNodeEntry) => e.nodeId !== excludeNodeId)
        : entries;
    return filtered.map(nodeEntryToObstacle);
}

/**
 * Query edge segments from a spatial index within a search area.
 */
export function queryEdgeSegmentsFromIndex(
    index: SpatialIndex,
    searchRect: Rect
): readonly EdgeSegment[] {
    return queryEdgesInRect(index, searchRect).map(edgeEntryToSegment);
}

/**
 * Extract a unified obstacle array from a spatial index around a parent position.
 * Drop-in replacement for extractObstaclesFromGraph / extractObstaclesFromCytoscape + extractEdgeSegmentsFrom*.
 *
 * Uses O(log n + k) R-tree queries instead of O(k) BFS traversal.
 * Captures geometrically nearby nodes regardless of graph topology — catches obstacles
 * that BFS misses when nodes are close spatially but distant topologically.
 *
 * @param index - The spatial index to query
 * @param parentPos - Center of the parent node
 * @param excludeNodeId - Node ID to exclude from obstacles (typically the parent)
 * @param searchRadius - Radius around parentPos to search (default 1500px, covers 5-hop equivalent)
 */
export function extractFromSpatialIndex(
    index: SpatialIndex,
    parentPos: Position,
    excludeNodeId?: string,
    searchRadius: number = 1500
): readonly Obstacle[] {
    const searchRect: Rect = buildSearchRect(parentPos, searchRadius);
    const boxes: readonly Obstacle[] = queryObstaclesFromIndex(index, searchRect, excludeNodeId).map(boxObstacle);
    const segments: readonly Obstacle[] = queryEdgeSegmentsFromIndex(index, searchRect).map(segmentObstacle);
    return [...boxes, ...segments];
}

// ============================================================================
// Graph → SpatialIndex Construction
// ============================================================================

/** Estimated dimensions for a typical graph node (must match extractObstaclesFromGraph). */
const ESTIMATED_NODE_WIDTH: number = 200;
const ESTIMATED_NODE_HEIGHT: number = 60;

/**
 * Build a SpatialIndex from pure Graph data.
 *
 * Enables main-process callers (no renderer / no cytoscape) to perform
 * spatial queries using the same O(log n) R-tree as the renderer path.
 *
 * Node AABB: centered on position, 200×60 estimated rendered size.
 * Edge AABB: bounding box of source → target straight-line segment.
 */
export function buildSpatialIndexFromGraph(graph: Graph): SpatialIndex {
    const allEntries: ReadonlyArray<readonly [NodeIdAndFilePath, GraphNode]> =
        Object.entries(graph.nodes) as ReadonlyArray<readonly [NodeIdAndFilePath, GraphNode]>;

    const nodeEntries: readonly SpatialNodeEntry[] = allEntries
        .filter(([, node]) => O.isSome(node.nodeUIMetadata.position))
        .map(([nodeId, node]): SpatialNodeEntry => {
            const pos: Position = (node.nodeUIMetadata.position as O.Some<Position>).value;
            return {
                nodeId,
                minX: pos.x - ESTIMATED_NODE_WIDTH / 2,
                minY: pos.y - ESTIMATED_NODE_HEIGHT / 2,
                maxX: pos.x + ESTIMATED_NODE_WIDTH / 2,
                maxY: pos.y + ESTIMATED_NODE_HEIGHT / 2,
            };
        });

    const edgeEntries: readonly SpatialEdgeEntry[] = allEntries.flatMap(
        ([nodeId, node]): readonly SpatialEdgeEntry[] => {
            if (!O.isSome(node.nodeUIMetadata.position)) return [];
            const sourcePos: Position = (node.nodeUIMetadata.position as O.Some<Position>).value;
            return node.outgoingEdges.flatMap((edge): readonly SpatialEdgeEntry[] => {
                const targetNode: GraphNode | undefined = graph.nodes[edge.targetId];
                if (!targetNode || !O.isSome(targetNode.nodeUIMetadata.position)) return [];
                const targetPos: Position = (targetNode.nodeUIMetadata.position as O.Some<Position>).value;
                return [{
                    edgeId: `${nodeId}->${edge.targetId}`,
                    x1: sourcePos.x,
                    y1: sourcePos.y,
                    x2: targetPos.x,
                    y2: targetPos.y,
                    minX: Math.min(sourcePos.x, targetPos.x),
                    minY: Math.min(sourcePos.y, targetPos.y),
                    maxX: Math.max(sourcePos.x, targetPos.x),
                    maxY: Math.max(sourcePos.y, targetPos.y),
                }];
            });
        }
    );

    return createSpatialIndex(nodeEntries, edgeEntries);
}
