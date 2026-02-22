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
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState';
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
// Minimize/Restore Terminals
// =============================================================================

/**
 * Minimize a terminal — hide floating window, show badge on task node.
 * Immediate DOM hide + IPC to main process for data model sync.
 * PTY stays alive; xterm.js state preserved via display:none.
 */
export function minimizeTerminal(terminalId: TerminalId): void {
    const windowEl: HTMLElement | null = document.querySelector(
        `[data-floating-window-id="${terminalId}"]`
    );
    if (windowEl) windowEl.style.display = 'none';
    void window.electronAPI?.main.updateTerminalMinimized(terminalId, true);
}

/**
 * Restore a minimized terminal — show floating window, remove badge.
 * Immediate DOM show + IPC to main process + focus terminal.
 */
export function restoreTerminal(terminalId: TerminalId): void {
    const windowEl: HTMLElement | null = document.querySelector(
        `[data-floating-window-id="${terminalId}"]`
    );
    if (windowEl) windowEl.style.display = '';
    void window.electronAPI?.main.updateTerminalMinimized(terminalId, false);
    const instance: { dispose: () => void; focus?: () => void } | undefined = vanillaFloatingWindowInstances.get(terminalId);
    instance?.focus?.();
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
