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

import type { Core, CollectionReturnValue, SingularElementArgument } from 'cytoscape';
import { getResponsivePadding } from '@/utils/responsivePadding';
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState';

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
      const cy: Core = this.cy;
      const node: CollectionReturnValue = cy.getElementById(this.lastCreatedNodeId);
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
    const cy: Core = this.cy;
    const terminalNodes: CollectionReturnValue = cy.nodes().filter(
      (node) =>
        node.data('windowType') === 'Terminal' &&
        node.data('isShadowNode') === true
    );

    console.log('[GraphNavigationService] cycleTerminal called:', {
      direction,
      totalNodes: cy.nodes().length,
      terminalNodesFound: terminalNodes.length,
      allNodeIds: cy.nodes().map((n) => ({
        id: n.id(),
        isShadowNode: n.data('isShadowNode'),
        windowType: n.data('windowType')
      }))
    });

    if (terminalNodes.length === 0) {
      console.warn('[GraphNavigationService] No terminal nodes found. Create a terminal first!');
      return;
    }

    // Sort terminals
    const sortedTerminals: SingularElementArgument[] = terminalNodes.toArray().sort((a, b) =>
      a.id().localeCompare(b.id())
    );

    // Calculate next/previous index
    if (direction === 1) {
      this.currentTerminalIndex = (this.currentTerminalIndex + 1) % sortedTerminals.length;
    } else {
      this.currentTerminalIndex = (this.currentTerminalIndex - 1 + sortedTerminals.length) % sortedTerminals.length;
    }

    // Fit to terminal with reasonable padding
    const targetTerminal: SingularElementArgument = sortedTerminals[this.currentTerminalIndex];
    // Use 14% of viewport for terminal cycling (was 200px on 1440p)
    cy.fit(targetTerminal, getResponsivePadding(cy, 14));

    // Focus the terminal so keyboard input goes directly to it
    const terminalId: string = targetTerminal.id();
    const vanillaInstance: { dispose: () => void; focus?: () => void } | undefined = vanillaFloatingWindowInstances.get(terminalId);
    if (vanillaInstance?.focus) {
      vanillaInstance.focus();
    }
  }

  /**
   * Handle search result selection
   */
  handleSearchSelect(nodeId: string): void {
    console.log('[GraphNavigationService] handleSearchSelect called with nodeId:', nodeId);
    const cy: Core = this.cy;
    const node: CollectionReturnValue = cy.getElementById(nodeId);
    console.log('[GraphNavigationService] Found node:', node.length > 0, node);

    if (node.length > 0) {
      // Fit to node with padding
      console.log('[GraphNavigationService] Calling cy.fit on node');
      // Use 9% of viewport for search results (was 125px on 1440p)
      cy.fit(node, getResponsivePadding(cy, 9));

      // Select the node (deselect others first for clean single-selection)
      cy.$(':selected').unselect();
      node.select();

      // Flash the node to indicate selection
      node.addClass('highlighted');
      setTimeout(() => {
        node.removeClass('highlighted');
      }, 1000);
      console.log('[GraphNavigationService] GraphNode fitted, selected, and highlighted');
    } else {
      console.warn('[GraphNavigationService] GraphNode not found for relativeFilePathIsID:', nodeId);
    }
  }
}
