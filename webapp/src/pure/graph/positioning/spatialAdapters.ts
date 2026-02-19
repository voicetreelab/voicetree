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
import { queryNodesInRect, queryEdgesInRect } from '@/pure/graph/spatial';
import type { ObstacleBBox, EdgeSegment } from '@/pure/graph/positioning/findBestPosition';
import type { Position } from '@/pure/graph';

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
 * Extract obstacles and edge segments from a spatial index around a parent position.
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
): { readonly obstacles: readonly ObstacleBBox[]; readonly edgeSegments: readonly EdgeSegment[] } {
    const searchRect: Rect = buildSearchRect(parentPos, searchRadius);
    return {
        obstacles: queryObstaclesFromIndex(index, searchRect, excludeNodeId),
        edgeSegments: queryEdgeSegmentsFromIndex(index, searchRect),
    };
}
