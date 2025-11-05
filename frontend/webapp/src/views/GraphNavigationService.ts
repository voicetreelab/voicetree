/**
 * GraphNavigationService - Deep module for user-triggered navigation actions
 *
 * Minimal public API that hides:
 * - Last node tracking and navigation
 * - Terminal cycling logic and state
 * - Search result navigation
 * - Viewport fitting with appropriate padding
 *
 * This class owns all user-triggered navigation state and operations.
 */

import type { Core } from 'cytoscape';
import { getResponsivePadding } from '@/utils/responsivePadding';

/**
 * Manages all user-triggered navigation actions for the graph
 */
export class GraphNavigationService {
  private cy: Core;

  // Navigation state
  private lastCreatedNodeId: string | null = null;
  private currentTerminalIndex = 0;

  constructor(cy: Core) {
    this.cy = cy;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Set the last created node ID (for "fit to last node" feature)
   */
  setLastCreatedNodeId(nodeId: string): void {
    this.lastCreatedNodeId = nodeId;
  }

  /**
   * Fit viewport to the last created node
   */
  fitToLastNode(): void {
    if (this.lastCreatedNodeId) {
      const cy = this.cy;
      const node = cy.getElementById(this.lastCreatedNodeId);
      if (node.length > 0) {
        // Use 19% of viewport for comfortable zoom on new nodes (was 275px on 1440p)
        cy.fit(node, getResponsivePadding(cy, 19));
      }
    }
  }

  /**
   * Cycle through terminal windows
   * @param direction 1 for next, -1 for previous
   */
  cycleTerminal(direction: 1 | -1): void {
    const cy = this.cy;
    const terminalNodes = cy.nodes().filter(
      (node: any) =>
        node.data('id')?.startsWith('terminal-') &&
        node.data('isShadowNode') === true
    );

    if (terminalNodes.length === 0) {
      return;
    }

    // Sort terminals
    const sortedTerminals = terminalNodes.toArray().sort((a: any, b: any) =>
      a.id().localeCompare(b.id())
    );

    // Calculate next/previous index
    if (direction === 1) {
      this.currentTerminalIndex = (this.currentTerminalIndex + 1) % sortedTerminals.length;
    } else {
      this.currentTerminalIndex = (this.currentTerminalIndex - 1 + sortedTerminals.length) % sortedTerminals.length;
    }

    // Fit to terminal with reasonable padding
    const targetTerminal = sortedTerminals[this.currentTerminalIndex];
    // Use 14% of viewport for terminal cycling (was 200px on 1440p)
    cy.fit(targetTerminal, getResponsivePadding(cy, 14));
  }

  /**
   * Handle search result selection
   */
  handleSearchSelect(nodeId: string): void {
    console.log('[GraphNavigationService] handleSearchSelect called with nodeId:', nodeId);
    const cy = this.cy;
    const node = cy.getElementById(nodeId);
    console.log('[GraphNavigationService] Found node:', node.length > 0, node);

    if (node.length > 0) {
      // Fit to node with padding
      console.log('[GraphNavigationService] Calling cy.fit on node');
      // Use 9% of viewport for search results (was 125px on 1440p)
      cy.fit(node, getResponsivePadding(cy, 9));

      // Flash the node to indicate selection
      node.addClass('highlighted');
      setTimeout(() => {
        node.removeClass('highlighted');
      }, 1000);
      console.log('[GraphNavigationService] Node fitted and highlighted');
    } else {
      console.warn('[GraphNavigationService] Node not found for idAndFilePath:', nodeId);
    }
  }
}
