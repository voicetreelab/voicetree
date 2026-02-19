import type { Core } from 'cytoscape';

// Registry for layout triggers - allows external code to trigger layout via triggerLayout(cy)
export const layoutTriggers: Map<Core, () => void> = new Map<Core, () => void>();

// Registry for cola layout triggers - allows external code to run cola layout on demand
export const colaLayoutTriggers: Map<Core, () => void> = new Map<Core, () => void>();

// Registry for dirty-node markers - allows external code to mark a node as needing local layout
export const dirtyNodeMarkers: Map<Core, (nodeId: string) => void> = new Map<Core, (nodeId: string) => void>();

// Registry for full layout resets - allows external code to trigger fCOSE + Cola from scratch
export const fullLayoutTriggers: Map<Core, () => void> = new Map<Core, () => void>();

/**
 * Trigger a debounced layout run for the given cytoscape instance.
 * Use this for user-initiated resize events (expand button, CSS drag resize).
 */
export function triggerLayout(cy: Core): void {
  layoutTriggers.get(cy)?.();
}

/**
 * Trigger a one-shot cola layout run for the given cytoscape instance.
 * Use this for user-initiated "tidy up" / reorganize layout.
 */
export function triggerColaLayout(cy: Core): void {
  colaLayoutTriggers.get(cy)?.();
}

/**
 * Mark a node as dirty (needing local layout) and trigger a debounced layout.
 * Use this for user-initiated resize events where a specific node changed dimensions.
 */
export function markNodeDirty(cy: Core, nodeId: string): void {
  dirtyNodeMarkers.get(cy)?.(nodeId);
}

/**
 * Reset layout state and trigger a full fCOSE + Cola layout from scratch.
 * Use this when graph topology changes substantially (e.g. vault folders added/removed).
 */
export function triggerFullLayout(cy: Core): void {
  fullLayoutTriggers.get(cy)?.();
}
