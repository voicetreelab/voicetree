/**
 * Activity tracking for agent tabs (blue dot indicator)
 * Extracted from AgentTabsBar for modularity.
 * Phase 3: Routes state changes through main process (source of truth).
 * Uses targeted DOM updates for responsive UI.
 */

import * as O from 'fp-ts/lib/Option.js';
import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import { getTerminals } from '@/shell/edge/UI-edge/state/TerminalStore';
import { updateTerminalActivityDots } from './agentTabsDOMUpdates';
import type {} from '@/shell/electron';

/**
 * Mark a terminal as having activity (produced a node)
 * Checks both attachedToContextNodeId (context node) and anchoredToNodeId (task node)
 * Phase 3: Routes state changes through main process (source of truth).
 * Uses targeted DOM update for responsive UI.
 */
export function markTerminalActivityForContextNode(nodeId: string): void {
    const terminals: Map<TerminalId, TerminalData> = getTerminals();
    for (const [terminalId, terminal] of terminals) {
        // Check if node matches the context node (attachedToContextNodeId)
        if (terminal.attachedToContextNodeId === nodeId) {
            const newCount: number = terminal.activityCount + 1;
            // Phase 3: Update main process (source of truth)
            void window.electronAPI?.main.updateTerminalActivityState(terminalId, { activityCount: newCount });
            // Optimistic DOM update for responsive UI
            updateTerminalActivityDots(terminalId, newCount);
            //console.log(`[AgentTabsBar] Marked activity for terminal ${terminalId} (context match), count: ${newCount}`);
            return;
        }
        // Check if node matches the anchored task node (anchoredToNodeId)
        if (O.isSome(terminal.anchoredToNodeId) && terminal.anchoredToNodeId.value === nodeId) {
            const newCount: number = terminal.activityCount + 1;
            // Phase 3: Update main process (source of truth)
            void window.electronAPI?.main.updateTerminalActivityState(terminalId, { activityCount: newCount });
            // Optimistic DOM update for responsive UI
            updateTerminalActivityDots(terminalId, newCount);
            //console.log(`[AgentTabsBar] Marked activity for terminal ${terminalId} (anchor match), count: ${newCount}`);
            return;
        }
    }
}

/**
 * Clear activity dots for a specific terminal.
 * Phase 3: Routes state changes through main process (source of truth).
 * Uses targeted DOM update for responsive UI.
 */
export function clearActivityForTerminal(terminalId: TerminalId): void {
    // Phase 3: Update main process (source of truth)
    void window.electronAPI?.main.updateTerminalActivityState(terminalId, { activityCount: 0 });
    // Optimistic DOM update for responsive UI
    updateTerminalActivityDots(terminalId, 0);
}
