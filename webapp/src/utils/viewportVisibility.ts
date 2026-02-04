/**
 * Viewport visibility utilities for checking node visibility within the Cytoscape viewport.
 */
import type { Core } from 'cytoscape';

/**
 * Check if any non-shadow nodes are visible within the current viewport.
 * Uses bounding box intersection with cy.extent() to determine visibility.
 *
 * @param cy - Cytoscape core instance
 * @returns true if at least one non-shadow node is visible in viewport
 */
export function areNodesVisibleInViewport(cy: Core): boolean {
  const extent = cy.extent();
  const nodes = cy.nodes().filter(n => !n.data('isShadowNode'));

  // Empty graph case - no nodes to show
  if (nodes.length === 0) {
    return true; // Don't show toast for empty graphs
  }

  return nodes.some(node => {
    const bb = node.boundingBox();
    // Check if bounding boxes intersect
    return !(bb.x2 < extent.x1 || bb.x1 > extent.x2 ||
             bb.y2 < extent.y1 || bb.y1 > extent.y2);
  });
}
