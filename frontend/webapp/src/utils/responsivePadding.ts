import type { Core, CollectionReturnValue, NodeCollection } from 'cytoscape';

/**
 * Calculate responsive padding for cy.fit() based on viewport dimensions
 *
 * WARNING: Padding > 50% will break cy.fit() because padding is applied to both sides.
 * For single-node navigation, prefer cyFitWithRelativeZoom() instead.
 *
 * @param cy - Cytoscape core instance
 * @param targetPercentage - Desired padding as percentage of viewport (default 10%, capped at 45%)
 * @returns Padding in pixels that scales proportionally with viewport size
 */
export function getResponsivePadding(cy: Core, targetPercentage: number = 10): number {
  const width: number = cy.width();
  const height: number = cy.height();
  const minDimension: number = Math.min(width, height);
  // Cap at 45% to prevent cy.fit() breaking (padding applied to both sides)
  const cappedPercentage: number = Math.min(targetPercentage, 45);
  return Math.round((minDimension * cappedPercentage) / 100);
}

/**
 * Animate viewport to center on elements with the element taking up a target fraction of the viewport.
 *
 * Unlike cy.fit() with padding, this approach is mathematically bounded and intuitive:
 * - targetFraction=0.1 means "the element should take 10% of the viewport"
 * - targetFraction=0.5 means "the element should take 50% of the viewport"
 *
 * @param cy - Cytoscape core instance
 * @param eles - Element(s) to fit (node, edge, or collection)
 * @param targetFraction - Fraction of viewport the element should occupy (0.1 = 10%)
 * @param duration - Animation duration in ms (default 300)
 */
export function cyFitWithRelativeZoom(
  cy: Core,
  eles: CollectionReturnValue,
  targetFraction: number,
  duration: number = 300
): void {
  if (eles.length === 0) return;

  const bb: { w: number; h: number } = eles.boundingBox();
  if (bb.w === 0 || bb.h === 0) return;

  // Calculate zoom level so element takes up targetFraction of viewport
  // element_size * zoom = viewport_size * targetFraction
  // zoom = (viewport_size * targetFraction) / element_size
  const zoomForWidth: number = (cy.width() * targetFraction) / bb.w;
  const zoomForHeight: number = (cy.height() * targetFraction) / bb.h;

  // Use the smaller zoom to ensure element fits in both dimensions
  const targetZoom: number = Math.min(zoomForWidth, zoomForHeight);

  // Clamp to cytoscape's zoom limits
  const clampedZoom: number = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), targetZoom));

  cy.animate({
    center: { eles },
    zoom: clampedZoom,
    duration
  });
}

// Comfortable zoom range - only zoom if outside this range, otherwise just pan
const COMFORTABLE_ZOOM_MIN: number = 0.7;
const COMFORTABLE_ZOOM_MAX: number = 2;

/**
 * Animate viewport to center on a collection, with zoom based on average node size.
 *
 * Unlike cyFitWithRelativeZoom which zooms based on the collection's bounding box,
 * this zooms so that an average-sized node takes up targetFraction of the viewport.
 * This keeps node readability consistent regardless of how spread out nodes are.
 *
 * Smart zoom behavior: Only zooms if current zoom is outside comfortable range (0.7-2).
 * If already in comfortable range, just pans to center the elements.
 *
 * @param cy - Cytoscape core instance
 * @param eles - Collection of elements to fit
 * @param targetFraction - Fraction of viewport an average node should occupy (0.1 = 10%)
 * @param duration - Animation duration in ms (default 300)
 */
export function cyFitCollectionByAverageNodeSize(
  cy: Core,
  eles: CollectionReturnValue | NodeCollection,
  targetFraction: number,
  duration: number = 300
): void {
  const nodes: NodeCollection = eles.nodes();
  if (nodes.length === 0) return;

  const currentZoom: number = cy.zoom();
  const isInComfortableRange: boolean = currentZoom >= COMFORTABLE_ZOOM_MIN && currentZoom <= COMFORTABLE_ZOOM_MAX;

  // If already in comfortable zoom range, just pan to center
  if (isInComfortableRange) {
    cy.animate({ center: { eles }, duration });
    return;
  }

  // Calculate average node dimensions
  let totalWidth: number = 0;
  let totalHeight: number = 0;
  nodes.forEach(node => {
    const bb: { w: number; h: number } = node.boundingBox();
    totalWidth += bb.w;
    totalHeight += bb.h;
  });
  const avgWidth: number = totalWidth / nodes.length;
  const avgHeight: number = totalHeight / nodes.length;

  if (avgWidth === 0 || avgHeight === 0) return;

  // Calculate zoom so average node = targetFraction of viewport
  const zoomForWidth: number = (cy.width() * targetFraction) / avgWidth;
  const zoomForHeight: number = (cy.height() * targetFraction) / avgHeight;
  const targetZoom: number = Math.min(zoomForWidth, zoomForHeight);

  // Clamp to cytoscape's zoom limits
  const clampedZoom: number = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), targetZoom));

  cy.animate({
    center: { eles },
    zoom: clampedZoom,
    duration
  });
}
