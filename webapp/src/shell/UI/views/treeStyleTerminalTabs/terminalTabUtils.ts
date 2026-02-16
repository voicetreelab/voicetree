/**
 * Terminal Tab Utilities
 *
 * Extracted from AgentTabsBar.ts - contains utility functions used by other modules.
 * These functions provide minimal interfaces for:
 * - Navigation display order (for GraphNavigationService cycling)
 * - Pin/unpin terminal actions (for traffic-lights.ts)
 * - Zoom inactivity suppression (for cytoscape-floating-windows.ts)
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import {
    suppressInactivityDuringZoom as storeSuppress,
} from '@/shell/edge/UI-edge/state/AgentTabsStore';
import { getTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import { buildTerminalTree } from '@/pure/agentTabs/terminalTree';
import type {} from '@/shell/electron';

// =============================================================================
// Display Order for Navigation
// =============================================================================

/**
 * Get the current display order for pinned terminals (for GraphNavigationService cycling)
 * Returns terminal IDs in tree order (DFS: parent before children) matching visual tree-style tabs
 */
export function getDisplayOrderForNavigation(): TerminalId[] {
    const terminalsMap: Map<TerminalId, TerminalData> = getTerminals();
    const terminals: TerminalData[] = Array.from(terminalsMap.values());
    const pinnedTerminals: TerminalData[] = terminals.filter(t => t.isPinned);
    const treeNodes: import('@/pure/agentTabs/terminalTree').TerminalTreeNode[] = buildTerminalTree(pinnedTerminals);
    return treeNodes.map(node => node.terminal.terminalId);
}

// =============================================================================
// Pin/Unpin Terminals
// =============================================================================

/**
 * Unpin a terminal (move from pinned to unpinned section)
 * Routes through main process which is source of truth
 */
export function unpinTerminal(terminalId: TerminalId): void {
    void window.electronAPI?.main.updateTerminalPinned(terminalId, false);
}

/**
 * Pin a terminal (move from unpinned to pinned section)
 * Routes through main process which is source of truth
 */
export function pinTerminal(terminalId: TerminalId): void {
    void window.electronAPI?.main.updateTerminalPinned(terminalId, true);
}

// =============================================================================
// Zoom Suppression
// =============================================================================

/**
 * Suppress inactivity tracking during zoom operations
 * Delegates to AgentTabsStore
 */
export function suppressInactivityDuringZoom(): void {
    storeSuppress();
}
