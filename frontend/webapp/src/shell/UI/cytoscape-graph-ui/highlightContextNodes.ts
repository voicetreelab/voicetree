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
  performance.mark('highlightContainedNodes:start');

  const node: Awaited<ReturnType<typeof getNodeFromMainToUI>> = await getNodeFromMainToUI(contextNodeId);
  performance.mark('highlightContainedNodes:afterGetNode');

  const containedIds: readonly string[] = node.nodeUIMetadata.containedNodeIds ?? [];
  const containedIdSet: Set<string> = new Set(containedIds);

  performance.mark('highlightContainedNodes:beforeBatch');
  cy.batch(() => {
    performance.mark('highlightContainedNodes:batchStart');

    containedIds.forEach(id => {
      // Use cy.$id() to avoid CSS selector escaping issues with special characters like /
      cy.$id(id).addClass(CONTEXT_CONTAINED_CLASS);
    });
    performance.mark('highlightContainedNodes:afterNodeClasses');

    // Highlight only edges where both source and target are in containedIds
    cy.edges().forEach(edge => {
      const sourceId: string = edge.data('source') as string;
      const targetId: string = edge.data('target') as string;
      if (containedIdSet.has(sourceId) && containedIdSet.has(targetId)) {
        edge.addClass(CONTEXT_EDGE_CLASS);
      }
    });
    performance.mark('highlightContainedNodes:afterEdgeClasses');

    // Also highlight the edge from task node (parent) to this context node
    cy.edges().filter(edge => edge.data('target') === contextNodeId).addClass(CONTEXT_EDGE_CLASS);
    performance.mark('highlightContainedNodes:batchEnd');
  });
  performance.mark('highlightContainedNodes:afterBatch');

  // Log timing breakdown
  const entries: PerformanceEntryList = performance.getEntriesByType('mark')
    .filter(e => e.name.startsWith('highlightContainedNodes:'));
  if (entries.length > 0) {
    const start: number = entries.find(e => e.name === 'highlightContainedNodes:start')?.startTime ?? 0;
    console.log(`[highlightContainedNodes] Timing for ${containedIds.length} nodes:`);
    entries.forEach(e => {
      console.log(`  ${e.name}: +${(e.startTime - start).toFixed(1)}ms`);
    });
    // Clear marks for next call
    entries.forEach(e => performance.clearMarks(e.name));
  }
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

  cy.batch(() => {
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
  });
}

/**
 * Removes all context-contained highlighting from the graph.
 */
export function clearContainedHighlights(cy: Core): void {
  cy.batch(() => {
    cy.$('.' + CONTEXT_CONTAINED_CLASS).removeClass(CONTEXT_CONTAINED_CLASS);
    cy.$('.' + CONTEXT_EDGE_CLASS).removeClass(CONTEXT_EDGE_CLASS);
  });
}
