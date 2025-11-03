import type { CytoscapeCore } from '@/graph-core';

/**
 * Calculate responsive padding for cy.fit() based on viewport dimensions
 *
 * The problem: cy.fit() uses absolute pixel padding, which looks inconsistent across
 * different screen sizes. A fixed 125px padding appears too zoomed out on large monitors
 * (e.g., 2560x1440) but too zoomed in on smaller screens (e.g., 1920x1080).
 *
 * The solution: Calculate padding as a percentage of the viewport's smaller dimension.
 * This ensures consistent visual padding regardless of screen size.
 *
 * @param cy - Cytoscape core instance
 * @param targetPercentage - Desired padding as percentage of viewport (default 10%)
 * @returns Padding in pixels that scales proportionally with viewport size
 *
 * @example
 * // On 1920x1080 screen with 10% padding: 108px
 * // On 2560x1440 screen with 10% padding: 144px
 * cy.fit(node, getResponsivePadding(cy, 10));
 */
export function getResponsivePadding(cy: CytoscapeCore, targetPercentage: number = 10): number {
  const width = cy.width();
  const height = cy.height();

  // Use the smaller dimension to calculate padding
  // This ensures padding looks consistent on both portrait and landscape orientations
  const minDimension = Math.min(width, height);

  return Math.round((minDimension * targetPercentage) / 100);
}
