import type cytoscape from 'cytoscape';

/**
 * Update node sizes based on their degree (number of connections)
 * @param cy - Cytoscape instance
 * @param nodes - Optional specific nodes to update. If not provided, updates all nodes.
 */
export function updateNodeSizes(cy: cytoscape.Core, nodes?: cytoscape.NodeCollection): void {
  if (!cy) return;

  const nodesToUpdate: cytoscape.NodeCollection = nodes ?? cy.nodes();

  // Helper to validate that a value is a healthy non-negative number
  const isValidNumber: (val: number) => boolean = (val: number): boolean =>
    typeof val === 'number' && !isNaN(val) && isFinite(val) && val >= 0;

  // Batch all style updates to defer style recalculation until the end
  cy.batch(() => {
    nodesToUpdate.forEach(node => {
      // Skip shadow nodes - they have fixed dimensions set by floating window system
      if (node.data('isShadowNode')) return;

      let degree: number = node.degree();

      // Defensive check: ensure degree is a valid number, default to 0 if not
      if (!isValidNumber(degree)) {
        console.warn(`[updateNodeSizes] Invalid degree value for node ${node.id()}: ${degree}, defaulting to 0`);
        degree = 0;
      }

      // Logarithmic + linear scaling
      // This creates strong emphasis on low-to-mid degree differences
      // while still rewarding high-degree nodes
      const size: number = 5 + 15 * Math.log(degree + 3) + degree;

      // Scale other properties proportionally to size
      // Use size as base and scale others relative to it
      const width: number = size*0.7; // nodes themselves don't care visual information, so scale smaller.
      const height: number = size*0.7;
      const fontSize: number = 10 + size / 7; // Font scales with size (increased from 8 + size/8)
      const textWidth: number = size * 3 + 40; // Text width scales with size
      const borderWidth: number = 1 + size / 15; // Border scales with size
      const textOpacity: number = Math.min(1, 0.7 + degree / 100); // Slight opacity increase with degree

      // Validate all calculated values before applying
      if (!isValidNumber(width) || !isValidNumber(height) || !isValidNumber(fontSize) ||
          !isValidNumber(textWidth) || !isValidNumber(borderWidth) || !isValidNumber(textOpacity)) {
        console.error(`[updateNodeSizes] Calculated invalid style values for node ${node.id()}:`, {
          degree, size, width, height, fontSize, textWidth, borderWidth, textOpacity
        });
        return; // Skip this node to prevent NaN styles
      }

      node.style({
        'width': width,
        'height': height,
        'font-size': fontSize,
        'text-max-width': textWidth,
        'border-width': borderWidth,
        'text-opacity': textOpacity
      });
    });
  });
}
