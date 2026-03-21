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

import type { Core, CollectionReturnValue, NodeSingular } from 'cytoscape';
import { cyFitWithRelativeZoom } from '@/utils/responsivePadding';
import { addRecentlyVisited } from '@/shell/edge/UI-edge/state/RecentlyVisitedStore';
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState';
import { getTerminals, setActiveTerminalId } from '@/shell/edge/UI-edge/state/TerminalStore';
import { getTerminalId, getShadowNodeId, type TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getDisplayOrderForNavigation } from '@/shell/UI/views/treeStyleTerminalTabs/terminalTabUtils';
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import * as O from 'fp-ts/lib/Option.js';
import { linkMatchScore, getPathComponents } from '@/pure/graph/markdown-parsing/extract-edges';
import { getVisibleViewportMetrics, type VisibleViewportMetrics } from '@/utils/visibleViewport';
import { getEditorByNodeId } from '@/shell/edge/UI-edge/state/EditorStore';
import type { NodeIdAndFilePath } from '@/pure/graph';

const TERMINAL_CONTEXT_TARGET_FRACTION: number = 0.95;
const TERMINAL_MIN_ZOOM_THRESHOLD: number = 0.7;
const NODE_TARGET_FRACTION: number = 0.4;
const EDITOR_TARGET_FRACTION: number = 0.6;

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

  /**
   * Get the Cytoscape instance
   */
  getCy(): Core {
    return this.cy;
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
        const fraction: number = O.isSome(getEditorByNodeId(this.lastCreatedNodeId as NodeIdAndFilePath)) ? EDITOR_TARGET_FRACTION : NODE_TARGET_FRACTION;
        cyFitWithRelativeZoom(cy, node, fraction);
      }
    }
  }

  /**
   * Fit viewport to a terminal and its surrounding context (context node + d=1 neighbors),
   * update active terminal state, focus the terminal, and notify listeners.
   */
  fitToTerminal(terminal: TerminalData): void {
    const cy: Core = this.cy;
    const terminalId: TerminalId = getTerminalId(terminal);
    const shadowNodeId: string = getShadowNodeId(terminalId);

    // Note: Activity dots are NOT cleared here - they are cleared only when
    // the user explicitly clicks a tab (not when cycling through terminals).
    // This preserves the blue activity indicators when cycling between agents.

    // Get the shadow node from cy for viewport fitting
    const terminalShadowNode: CollectionReturnValue = cy.getElementById(shadowNodeId);

    cy.$(':selected').unselect();
    setActiveTerminalId(terminalId);

    // Collect terminal shadow node + its parent (context node)
    let nodesToFit: CollectionReturnValue = cy.collection().union(terminalShadowNode);

    // Use anchoredToNodeId (task node) if set, otherwise fall back to attachedToContextNodeId
    const parentNodeId: string | undefined = O.isSome(terminal.anchoredToNodeId)
      ? terminal.anchoredToNodeId.value
      : terminal.attachedToContextNodeId;
    if (parentNodeId) {
      const parentNode: CollectionReturnValue = cy.getElementById(parentNodeId);
      if (parentNode.length > 0) {
        nodesToFit = nodesToFit.union(parentNode);
      }
    }

    // If the zoom required to show terminal + parent is too zoomed out (< 0.7),
    // just fit to the terminal shadow node itself
    const bb: { w: number; h: number } = nodesToFit.boundingBox();
    const viewport: VisibleViewportMetrics = getVisibleViewportMetrics(cy);
    const requiredZoom: number = (bb.w > 0 && bb.h > 0)
      ? Math.min((viewport.width * TERMINAL_CONTEXT_TARGET_FRACTION) / bb.w, (viewport.height * TERMINAL_CONTEXT_TARGET_FRACTION) / bb.h)
      : Infinity;

    if (requiredZoom < TERMINAL_MIN_ZOOM_THRESHOLD) {
      // Too zoomed out to show both — just fit the terminal shadow node at 95%
      cyFitWithRelativeZoom(cy, terminalShadowNode, TERMINAL_CONTEXT_TARGET_FRACTION);
    } else {
      cyFitWithRelativeZoom(cy, nodesToFit, TERMINAL_CONTEXT_TARGET_FRACTION);
    }

    // Focus the terminal so keyboard input goes directly to it
    // Note: terminals are stored in vanillaFloatingWindowInstances with terminalId as key (not shadowNodeId)
    const vanillaInstance: { dispose: () => void; focus?: () => void; scrollToBottom?: () => void } | undefined = vanillaFloatingWindowInstances.get(terminalId);
    if (vanillaInstance?.focus) {
      vanillaInstance.focus();
    }
    // Scroll to the end of terminal output when navigating
    if (vanillaInstance?.scrollToBottom) {
      vanillaInstance.scrollToBottom();
      // Additional delayed scroll + focus to ensure content is fully loaded
      // and terminal is focusable after viewport animation completes
      setTimeout(() => {
        vanillaInstance.focus?.();
        vanillaInstance.scrollToBottom?.();
      }, 800);
    }
  }

  /**
   * Cycle through terminal windows
   * @param direction 1 for next, -1 for previous
   */
  cycleTerminal(direction: 1 | -1): void {
    // Get terminals from TerminalStore (source of truth)
    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();
    const terminals: TerminalData[] = Array.from(terminalsMap.values());

    //console.log('[GraphNavigationService] cycleTerminal called:', {
    //  direction,
    //  terminalsFromStore: terminals.length,
    //  terminalIds: terminals.map(t => getTerminalId(t))
    //});

    if (terminals.length === 0) {
      console.warn('[GraphNavigationService] No terminals found. Create a terminal first!');
      return;
    }

    // Use display order from AgentTabsBar (respects user's drag-drop ordering)
    // Falls back to ID sort if AgentTabsBar not initialized
    const displayOrder: TerminalId[] = getDisplayOrderForNavigation();
    const orderedTerminals: TerminalData[] = displayOrder.length > 0
      ? displayOrder
          .map(id => terminals.find(t => getTerminalId(t) === id))
          .filter((t): t is TerminalData => t !== undefined)
      : terminals.sort((a, b) => getTerminalId(a).localeCompare(getTerminalId(b)));

    // Calculate next/previous index
    if (direction === 1) {
      this.currentTerminalIndex = (this.currentTerminalIndex + 1) % orderedTerminals.length;
    } else {
      this.currentTerminalIndex = (this.currentTerminalIndex - 1 + orderedTerminals.length) % orderedTerminals.length;
    }

    const targetTerminal: TerminalData = orderedTerminals[this.currentTerminalIndex];

    // fitToTerminal handles state update, viewport fit, focus, and notification
    this.fitToTerminal(targetTerminal);
  }

  /**
   * Handle search result selection
   */
  handleSearchSelect(nodeId: string): void {
    //console.log('[GraphNavigationService] handleSearchSelect called with nodeId:', nodeId);
    const cy: Core = this.cy;
    let node: CollectionReturnValue = cy.getElementById(nodeId);
    let resolvedNodeId: string = nodeId;

    // Fallback: fuzzy suffix matching (same logic as wikilink resolution)
    // Handles SSE events that send relative paths while cytoscape uses absolute paths
    if (node.length === 0) {
      const linkComponents: readonly string[] = getPathComponents(nodeId);
      if (linkComponents.length > 0) {
        const match: { node: NodeSingular | null; score: number } = { node: null, score: 0 };
        cy.nodes().forEach((n: NodeSingular) => {
          if (n.data('isShadowNode') || n.data('isContextNode') || n.data('isFolderNode')) return;
          const score: number = linkMatchScore(nodeId, n.id());
          if (score >= linkComponents.length && score > match.score) {
            match.score = score;
            match.node = n;
          }
        });
        if (match.node) {
          node = match.node as CollectionReturnValue;
          resolvedNodeId = match.node.id();
        }
      }
    }

    //console.log('[GraphNavigationService] Found node:', node.length > 0, node);

    if (node.length > 0) {
      // Track as recently visited for command palette ordering
      addRecentlyVisited(resolvedNodeId);

      const fraction: number = O.isSome(getEditorByNodeId(resolvedNodeId as NodeIdAndFilePath)) ? EDITOR_TARGET_FRACTION : NODE_TARGET_FRACTION;
      cyFitWithRelativeZoom(cy, node, fraction);

      // Select the node (deselect others first for clean single-selection)
      cy.$(':selected').unselect();
      node.select();

      // Flash the node to indicate selection
      node.addClass('highlighted');
      setTimeout(() => {
        node.removeClass('highlighted');
      }, 1000);
      //console.log('[GraphNavigationService] GraphNode fitted, selected, and highlighted');
    } else {
      console.warn('[GraphNavigationService] GraphNode not found for relativeFilePathIsID:', nodeId);
    }
  }
}
