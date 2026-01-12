/**
 * Utilities for highlighting nodes contained within a context node's snapshot.
 */
import type { Core } from 'cytoscape';
import { getNodeFromMainToUI } from '@/shell/edge/UI-edge/graph/getNodeFromMainToUI';
import { CONTEXT_CONTAINED_CLASS, CONTEXT_EDGE_CLASS } from './constants';

/**
 * Highlights all nodes contained within a context node's snapshot.
 * Fetches containedNodeIds from graph API (not Cytoscape data).
 * Adds CSS class to nodes and their incoming edges.
 */
export async function highlightContainedNodes(cy: Core, contextNodeId: string): Promise<void> {
  const node: Awaited<ReturnType<typeof getNodeFromMainToUI>> = await getNodeFromMainToUI(contextNodeId);
  const containedIds: readonly string[] = node.nodeUIMetadata.containedNodeIds ?? [];

  containedIds.forEach(id => {
    cy.$('#' + id).addClass(CONTEXT_CONTAINED_CLASS);
    cy.edges('[target="' + id + '"]').addClass(CONTEXT_EDGE_CLASS);
  });
}

/**
 * Removes all context-contained highlighting from the graph.
 */
export function clearContainedHighlights(cy: Core): void {
  cy.$('.' + CONTEXT_CONTAINED_CLASS).removeClass(CONTEXT_CONTAINED_CLASS);
  cy.$('.' + CONTEXT_EDGE_CLASS).removeClass(CONTEXT_EDGE_CLASS);
}
