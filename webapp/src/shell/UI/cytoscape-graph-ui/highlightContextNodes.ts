/**
 * Utilities for highlighting nodes contained within a context node's snapshot.
 */
import type { Core } from 'cytoscape';
import { getNodeFromMainToUI } from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import { CONTEXT_CONTAINED_CLASS, CONTEXT_EDGE_CLASS } from './constants';

/**
 * Highlights all nodes contained within a context node's snapshot.
 * Fetches containedNodeIds from graph API (not Cytoscape data).
 * Adds CSS class to nodes and edges between them.
 */
export async function highlightContainedNodes(cy: Core, contextNodeId: string): Promise<void> {
  const node: Awaited<ReturnType<typeof getNodeFromMainToUI>> = await getNodeFromMainToUI(contextNodeId);
  const containedIds: readonly string[] = node.nodeUIMetadata.containedNodeIds ?? [];
  const containedIdSet: Set<string> = new Set(containedIds);

  containedIds.forEach(id => {
    // Use cy.$id() to avoid CSS selector escaping issues with special characters like /
    cy.$id(id).addClass(CONTEXT_CONTAINED_CLASS);
  });

  // Highlight only edges where both source and target are in containedIds
  cy.edges().forEach(edge => {
    const sourceId: string = edge.data('source') as string;
    const targetId: string = edge.data('target') as string;
    if (containedIdSet.has(sourceId) && containedIdSet.has(targetId)) {
      edge.addClass(CONTEXT_EDGE_CLASS);
    }
  });

  // Also highlight the edge from task node (parent) to this context node
  cy.edges().filter(edge => edge.data('target') === contextNodeId).addClass(CONTEXT_EDGE_CLASS);
}

/**
 * Highlights nodes that would be captured if a context node were created from the given node.
 * Used for preview when hovering Run button on a normal (non-context) node.
 */
export async function highlightPreviewNodes(cy: Core, nodeId: string): Promise<void> {
  const api: typeof window.electronAPI | undefined = window.electronAPI;
  if (!api) return;

  const result: readonly string[] | { error: string } = await api.main.getPreviewContainedNodeIds(nodeId);

  // Handle RPC error response - silently return for preview feature
  if (result && typeof result === 'object' && 'error' in result) {
    console.warn('[highlightPreviewNodes] RPC error:', (result as { error: string }).error);
    return;
  }

  const containedIds: readonly string[] = result as readonly string[];
  const containedIdSet: Set<string> = new Set(containedIds);

  containedIds.forEach(id => {
    // Use cy.$id() to avoid CSS selector escaping issues with special characters like /
    cy.$id(id).addClass(CONTEXT_CONTAINED_CLASS);
  });

  // Highlight only edges where both source and target are in containedIds
  cy.edges().forEach(edge => {
    const sourceId: string = edge.data('source') as string;
    const targetId: string = edge.data('target') as string;
    if (containedIdSet.has(sourceId) && containedIdSet.has(targetId)) {
      edge.addClass(CONTEXT_EDGE_CLASS);
    }
  });
}

/**
 * Removes all context-contained highlighting from the graph.
 */
export function clearContainedHighlights(cy: Core): void {
  cy.$('.' + CONTEXT_CONTAINED_CLASS).removeClass(CONTEXT_CONTAINED_CLASS);
  cy.$('.' + CONTEXT_EDGE_CLASS).removeClass(CONTEXT_EDGE_CLASS);
}
