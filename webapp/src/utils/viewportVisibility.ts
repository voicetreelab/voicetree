/**
 * Viewport visibility utilities for checking node visibility within the Cytoscape viewport.
 */
import type { Core, BoundingBox, BoundingBox12, BoundingBoxWH, NodeCollection } from 'cytoscape';
import { getCurrentIndex } from '@/shell/UI/cytoscape-graph-ui/services/spatialIndexSync';
import { queryNodesInRect } from '@vt/graph-model/spatial';
import type { Rect, SpatialIndex, SpatialNodeEntry } from '@vt/graph-model/spatial';
import { getVisibleViewportExtent } from '@/utils/visibleViewport';

/**
 * Check if any nodes (including shadow nodes for floating windows) are visible
 * within the current viewport.
 *
 * Uses R-tree spatial index when available for O(log n + k) performance,
 * falling back to O(n) iteration when the spatial index is not enabled.
 *
 * @param cy - Cytoscape core instance
 * @returns true if at least one node is visible in viewport
 */
export function areNodesVisibleInViewport(cy: Core): boolean {
  const extent: BoundingBox = getVisibleViewportExtent(cy);

  // Fast path: R-tree spatial index query — O(log n + k)
  const index: SpatialIndex | undefined = getCurrentIndex(cy);
  if (index) {
    const rect: Rect = {
      minX: extent.x1,
      minY: extent.y1,
      maxX: extent.x2,
      maxY: extent.y2,
    };
    const hits: readonly SpatialNodeEntry[] = queryNodesInRect(index, rect);
    if (hits.length > 0) return true;
    // No nodes in viewport — check if graph is empty (don't show toast for empty graphs)
    return cy.nodes().length === 0;
  }

  // Fallback: O(n) iteration when spatial index not available
  const nodes: NodeCollection = cy.nodes();

  // Empty graph case - no nodes to show
  if (nodes.length === 0) {
    return true; // Don't show toast for empty graphs
  }

  return nodes.some(node => {
    const bb: BoundingBox12 & BoundingBoxWH = node.boundingBox();
    // Check if bounding boxes intersect
    return !(bb.x2 < extent.x1 || bb.x1 > extent.x2 ||
             bb.y2 < extent.y1 || bb.y1 > extent.y2);
  });
}
