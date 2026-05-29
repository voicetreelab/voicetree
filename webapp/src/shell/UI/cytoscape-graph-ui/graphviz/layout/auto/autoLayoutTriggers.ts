import type { Core } from 'cytoscape';

type AutoLayoutTriggerSet = {
  readonly runColaLayout: () => void
  readonly markDirtyNode: (nodeId: string) => void
  readonly runFullLayout: () => void
}

// Registry for layout triggers - allows external code to trigger layout via a narrow API.
const layoutTriggers: Map<Core, AutoLayoutTriggerSet> = new Map<Core, AutoLayoutTriggerSet>();

export function registerAutoLayoutTriggers(cy: Core, triggers: AutoLayoutTriggerSet): void {
  layoutTriggers.set(cy, triggers);
}

export function unregisterAutoLayoutTriggers(cy: Core): void {
  layoutTriggers.delete(cy);
}

/**
 * Trigger a one-shot cola layout run for the given cytoscape instance.
 * Use this for user-initiated "tidy up" / reorganize layout.
 */
export function triggerColaLayout(cy: Core): void {
  layoutTriggers.get(cy)?.runColaLayout();
}

/**
 * Mark a node as dirty (needing local layout) and trigger a debounced layout.
 * Use this for user-initiated resize events where a specific node changed dimensions.
 */
export function markNodeDirty(cy: Core, nodeId: string): void {
  layoutTriggers.get(cy)?.markDirtyNode(nodeId);
}

/**
 * Reset layout state and trigger a full R-tree pack + Cola layout from scratch.
 * Use this when graph topology changes substantially (e.g. project folders added/removed).
 */
export function triggerFullLayout(cy: Core): void {
  layoutTriggers.get(cy)?.runFullLayout();
}
