/**
 * Subscribe to graph update events and apply them to Cytoscape
 *
 * This is the UI boundary - it listens to browser CustomEvents
 * (dispatched by preload) and applies deltas to the Cytoscape instance.
 */

import type { Core } from 'cytoscape';
import type { GraphDelta } from '@/functional_graph/pure/types';
import { applyGraphDeltaToUI } from './applyGraphDeltaToUI';

/**
 * Subscribe to graph state changes and apply deltas to Cytoscape
 * @param cy - Cytoscape instance
 * @returns Cleanup function to unsubscribe
 */
export const subscribeToGraphUpdates = (cy: Core): (() => void) => {
  const handleGraphStateChanged = (event: Event): void => {
    const delta = (event as CustomEvent<GraphDelta>).detail;
    console.log('[subscribeToGraphUpdates] Received graph delta');
    applyGraphDeltaToUI(cy, delta);
  };

  // Listen to browser events dispatched by preload
  window.addEventListener('graph:stateChanged', handleGraphStateChanged);

  // Return cleanup function
  return () => {
    window.removeEventListener('graph:stateChanged', handleGraphStateChanged);
  };
};
