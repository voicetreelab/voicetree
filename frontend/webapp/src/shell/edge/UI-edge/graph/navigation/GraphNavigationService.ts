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

import type { Core, CollectionReturnValue } from 'cytoscape';
import { getResponsivePadding } from '@/utils/responsivePadding';
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState';
import { getTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import { getTerminalId, getShadowNodeId, type TerminalData, type TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';

/**
 * Manages all user-triggered navigation actions for the graph
 */
export class GraphNavigationService { // TODO MAKE THIS NOT USE A CLASS
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
   * Fit viewport to a terminal and its surrounding context (context node + d=1 neighbors)
   */
  fitToTerminal(terminal: TerminalData): void {
    const cy: Core = this.cy;
    const terminalId: TerminalId = getTerminalId(terminal);
    const shadowNodeId: string = getShadowNodeId(terminalId);

    // Get the shadow node from cy for viewport fitting
    const terminalShadowNode: CollectionReturnValue = cy.getElementById(shadowNodeId);

    // Get context node (attachedToNodeId) and its neighborhood
    const contextNodeId: string = terminal.attachedToNodeId;
    const contextNode: CollectionReturnValue = cy.getElementById(contextNodeId);

    // closedNeighborhood includes the node itself plus all directly connected nodes (d=1)
    // Union with terminal shadow node to ensure terminal is always in viewport
    const nodesToFit: CollectionReturnValue = contextNode.length > 0
      ? contextNode.closedNeighborhood().nodes().union(terminalShadowNode)
      : cy.collection().union(terminalShadowNode);

    cy.fit(nodesToFit, getResponsivePadding(cy, 1));
  }

  /**
   * Cycle through terminal windows
   * @param direction 1 for next, -1 for previous
   */
  cycleTerminal(direction: 1 | -1): void {
    // Get terminals from TerminalStore (source of truth)
    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();
    const terminals: TerminalData[] = Array.from(terminalsMap.values());

    console.log('[GraphNavigationService] cycleTerminal called:', {
      direction,
      terminalsFromStore: terminals.length,
      terminalIds: terminals.map(t => getTerminalId(t))
    });

    if (terminals.length === 0) {
      console.warn('[GraphNavigationService] No terminals found. Create a terminal first!');
      return;
    }

    // Sort terminals by ID for consistent ordering
    const sortedTerminals: TerminalData[] = terminals.sort((a, b) =>
      getTerminalId(a).localeCompare(getTerminalId(b))
    );

    // Calculate next/previous index
    if (direction === 1) {
      this.currentTerminalIndex = (this.currentTerminalIndex + 1) % sortedTerminals.length;
    } else {
      this.currentTerminalIndex = (this.currentTerminalIndex - 1 + sortedTerminals.length) % sortedTerminals.length;
    }

    const targetTerminal: TerminalData = sortedTerminals[this.currentTerminalIndex];

    // Fit viewport to terminal + surrounding context
    this.fitToTerminal(targetTerminal);

    // Focus the terminal so keyboard input goes directly to it
    const shadowNodeId: string = getShadowNodeId(getTerminalId(targetTerminal));
    const vanillaInstance: { dispose: () => void; focus?: () => void } | undefined = vanillaFloatingWindowInstances.get(shadowNodeId);
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
