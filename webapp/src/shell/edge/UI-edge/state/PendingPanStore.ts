/**
 * PendingPanStore - Edge state for tracking nodes that need panning after layout completes
 *
 * Instead of panning to new nodes after an arbitrary timeout, we track which nodes
 * need panning and execute the pan when layout finishes (on layoutstop).
 * This ensures the pan happens at the right time regardless of how long layout takes.
 */

import type { Core, CollectionReturnValue } from 'cytoscape';
import { cyFitCollectionByAverageNodeSize, cySmartCenter, getResponsivePadding } from '@/utils/responsivePadding';

export type PendingPanType = 'large-batch' | 'small-graph' | 'wikilink-target' | null;

interface PendingPanState {
  type: PendingPanType;
  nodeIds: string[];
  totalNodes: number;
  targetNodeId?: string;  // For wikilink-target type
}

// Module-level state (follows project pattern)
let pendingPan: PendingPanState | null = null;

/**
 * Set a pending pan to be executed when layout completes.
 * @param type The type of pan to execute ('large-batch' for cy.fit, 'small-graph' for smart zoom)
 * @param nodeIds The IDs of the new nodes to potentially fit
 * @param totalNodes Total number of nodes in the graph at time of setting
 */
export function setPendingPan(type: PendingPanType, nodeIds: string[], totalNodes: number): void {
  if (type === null) {
    pendingPan = null;
    return;
  }
  pendingPan = { type, nodeIds, totalNodes };
}

/**
 * Set a pending pan to navigate to a specific node after layout.
 * Used when user adds a wikilink in an editor, clicks a node to open an editor,
 * or creates a new node via UI.
 */
export function setPendingPanToNode(targetNodeId: string): void {
  pendingPan = { type: 'wikilink-target', nodeIds: [], totalNodes: 0, targetNodeId };
}

/**
 * Check if there's a pending pan
 */
export function hasPendingPan(): boolean {
  return pendingPan !== null;
}

/**
 * Pan the viewport to the tracked node without clearing pending state.
 * Can be called multiple times during a layout chain — each layout phase
 * pans to keep the node visible. State is cleared separately by clearPendingPan().
 * Returns true if a pan was executed, false otherwise.
 */
export function panToTrackedNode(cy: Core): boolean {
  if (!pendingPan || cy.destroyed()) {
    return false;
  }

  const { type, targetNodeId } = pendingPan;

  const zoomBefore: number = cy.zoom();
  const panBefore: { x: number; y: number } = cy.pan();
  const cyW: number = cy.width();
  const cyH: number = cy.height();
  const bb: { x1: number; y1: number; x2: number; y2: number; w: number; h: number } = cy.elements().boundingBox();

  console.warn(
    `[panToTrackedNode] type=${type}, viewport=${cyW}x${cyH}, zoom=${zoomBefore.toFixed(4)}, pan=(${panBefore.x.toFixed(0)},${panBefore.y.toFixed(0)}), `
    + `elementsBB: (${bb.x1.toFixed(0)},${bb.y1.toFixed(0)})→(${bb.x2.toFixed(0)},${bb.y2.toFixed(0)}) ${bb.w.toFixed(0)}x${bb.h.toFixed(0)}, `
    + `nodes=${cy.nodes().length}, edges=${cy.edges().length}`
  );

  if (type === 'large-batch') {
    // Large batch (>30% new nodes): fit all in view with padding
    const padding: number = getResponsivePadding(cy, 15);
    console.warn(`[panToTrackedNode] large-batch: cy.fit(all, padding=${padding})`);
    cy.fit(undefined, padding);
    console.warn(`[panToTrackedNode] after fit: zoom=${cy.zoom().toFixed(4)}, pan=(${cy.pan().x.toFixed(0)},${cy.pan().y.toFixed(0)})`);
    return true;
  } else if (type === 'small-graph') {
    // Fit so average node takes target fraction of viewport (smart zoom: only zooms if needed)
    console.warn(`[panToTrackedNode] small-graph: cyFitCollectionByAverageNodeSize`);
    cyFitCollectionByAverageNodeSize(cy, cy.nodes(), 0.15);
    return true;
  } else if (type === 'wikilink-target' && targetNodeId) {
    const targetNode: CollectionReturnValue = cy.getElementById(targetNodeId);
    if (targetNode.length > 0) {
      // Include target + d=1 neighbors for spatial context
      const nodesToCenter: CollectionReturnValue = targetNode.closedNeighborhood().nodes() as CollectionReturnValue;
      console.warn(`[panToTrackedNode] wikilink-target: centering on ${targetNodeId}`);
      cySmartCenter(cy, nodesToCenter);
      return true;
    }
  }

  return false;
}

/**
 * Consume and execute the pending pan on the given cytoscape instance.
 * Thin wrapper: pans viewport then clears state. Used by external callers
 * that want the original consume-and-clear semantics.
 * Returns true if a pan was executed, false otherwise.
 */
export function consumePendingPan(cy: Core): boolean {
  const result: boolean = panToTrackedNode(cy);
  clearPendingPan();
  return result;
}

/**
 * Clear any pending pan (for cleanup)
 */
export function clearPendingPan(): void {
  pendingPan = null;
}
