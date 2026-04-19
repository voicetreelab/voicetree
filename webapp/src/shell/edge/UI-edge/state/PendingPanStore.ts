/**
 * PendingPanStore - Edge state for tracking nodes that need panning after layout completes
 *
 * Instead of panning to new nodes after an arbitrary timeout, we track which nodes
 * need panning and execute the pan when layout finishes (on layoutstop).
 * This ensures the pan happens at the right time regardless of how long layout takes.
 */

export type PendingPanType = 'large-batch' | 'small-graph' | 'wikilink-target' | 'voice-follow' | 'editor-focus' | null;

interface PendingPanState {
  type: PendingPanType;
  nodeIds: string[];
  totalNodes: number;
  targetNodeId?: string;  // For wikilink-target and voice-follow types
}

// Module-level state (follows project pattern)
let pendingPan: PendingPanState | null = null;

/**
 * Describes the viewport operation to execute — computed from pending state, applied by the
 * cy seam (applyPendingPan.ts). Pure data: no cytoscape types here.
 */
export type PanAction =
  | { readonly kind: 'fit-non-folder-elements'; readonly paddingPercent: number }
  | { readonly kind: 'fit-non-folder-nodes'; readonly targetFraction: number }
  | { readonly kind: 'smart-center-with-neighbors'; readonly nodeId: string }
  | { readonly kind: 'smart-center'; readonly nodeId: string }
  | { readonly kind: 'center-in-viewport'; readonly nodeId: string; readonly duration: number };

/**
 * Set a pending pan to be executed when layout completes.
 * @param type The type of pan to execute ('large-batch' for viewport fit, 'small-graph' for smart zoom)
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
 * Set a pending pan to follow a voice-created node after layout.
 * Used when a new /voice/ node is created during dictation —
 * pans to the latest voice node so the view follows the user's speech.
 */
export function setPendingVoiceFollowPan(targetNodeId: string): void {
  pendingPan = { type: 'voice-follow', nodeIds: [], totalNodes: 0, targetNodeId };
}

/**
 * Set a pending pan to keep the focused editor's node in viewport after layout.
 * Pans to center the node without changing zoom — minimal disruption while editing.
 */
export function setPendingEditorFocusPan(targetNodeId: string): void {
  pendingPan = { type: 'editor-focus', nodeIds: [], totalNodes: 0, targetNodeId };
}

/**
 * Check if there's a pending pan
 */
export function hasPendingPan(): boolean {
  return pendingPan !== null;
}

/**
 * Compute the viewport action for the current pending pan state.
 * Pure — no cytoscape access. The caller (applyPendingPan seam) applies it to the instance.
 * Returns null if no pan is pending or if required data is missing.
 */
export function computePendingPanAction(): PanAction | null {
  if (!pendingPan) return null;
  const { type, targetNodeId } = pendingPan;

  if (type === 'large-batch') {
    // Large batch (>30% new nodes): fit all non-folder elements in view with padding
    return { kind: 'fit-non-folder-elements', paddingPercent: 15 };
  }
  if (type === 'small-graph') {
    // Fit so average node takes 15% of viewport (smart zoom: only zooms if needed)
    return { kind: 'fit-non-folder-nodes', targetFraction: 0.15 };
  }
  if (type === 'wikilink-target' && targetNodeId) {
    // Center on target + d=1 neighbors for spatial context (exclude folder compound nodes)
    return { kind: 'smart-center-with-neighbors', nodeId: targetNodeId };
  }
  if (type === 'voice-follow' && targetNodeId) {
    return { kind: 'smart-center', nodeId: targetNodeId };
  }
  if (type === 'editor-focus' && targetNodeId) {
    // Pan to keep focused editor in viewport without changing zoom.
    // targetNodeId may be a shadow node (not in graph model) — seam handles cy lookup.
    return { kind: 'center-in-viewport', nodeId: targetNodeId, duration: 200 };
  }
  return null;
}

/**
 * Clear any pending pan (for cleanup)
 */
export function clearPendingPan(): void {
  pendingPan = null;
}
