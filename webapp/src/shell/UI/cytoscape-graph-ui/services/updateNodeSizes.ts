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

      // Defensive: default to 0 if degree is invalid (e.g. node detached from graph)
      if (!isValidNumber(degree)) {
        degree = 0;
      }

      // Logarithmic + linear scaling
      // This creates strong emphasis on low-to-mid degree differences
      // while still rewarding high-degree nodes
      const size: number = 5 + 15 * Math.log(degree + 3) + degree;

      // Scale other properties proportionally to size
      // Use size as base and scale others relative to it
      const width: number = size * 1.4; // 2x visual scale (was size*0.7)
      const height: number = size * 1.4;
      const fontSize: number = 15 + size * 1.5 / 7; // 1.5x font scale (was 10 + size/7)
      const textWidth: number = size * 6 + 80; // 2x text width to match node scale (was size*3+40)
      const borderWidth: number = 2 + size / 7.5; // 2x border scale (was 1 + size/15)
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
