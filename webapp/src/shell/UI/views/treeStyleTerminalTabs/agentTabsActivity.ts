/**
 * Activity tracking for agent tabs (blue dot indicator)
 * Extracted from AgentTabsBar for modularity.
 * Phase 3: Routes state changes through main process (source of truth).
 * Updates local TerminalStore + notifies subscribers so React re-renders.
 */

import * as O from 'fp-ts/lib/Option.js';
import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import { getTerminals, updateTerminalActivityAndNotify } from '@/shell/edge/UI-edge/state/TerminalStore';
import type {} from '@/shell/electron';

/**
 * Mark a terminal as having activity (produced a node)
 * Checks both attachedToContextNodeId (context node) and anchoredToNodeId (task node)
 * Phase 3: Routes state changes through main process (source of truth).
 * Updates local store + notifies subscribers for React re-render.
 */
export function markTerminalActivityForContextNode(nodeId: string): void {
    const terminals: Map<TerminalId, TerminalData> = getTerminals();
    for (const [terminalId, terminal] of terminals) {
        // Check if node matches the context node (attachedToContextNodeId)
        if (terminal.attachedToContextNodeId === nodeId) {
            const newCount: number = terminal.activityCount + 1;
            // Phase 3: Update main process (source of truth)
            void window.electronAPI?.main.updateTerminalActivityState(terminalId, { activityCount: newCount });
            // Update local store + notify subscribers (React re-renders)
            updateTerminalActivityAndNotify(terminalId, newCount);
            return;
        }
        // Check if node matches the anchored task node (anchoredToNodeId)
        if (O.isSome(terminal.anchoredToNodeId) && terminal.anchoredToNodeId.value === nodeId) {
            const newCount: number = terminal.activityCount + 1;
            // Phase 3: Update main process (source of truth)
            void window.electronAPI?.main.updateTerminalActivityState(terminalId, { activityCount: newCount });
            // Update local store + notify subscribers (React re-renders)
            updateTerminalActivityAndNotify(terminalId, newCount);
            return;
        }
    }
}

/**
 * Clear activity dots for a specific terminal.
 * Phase 3: Routes state changes through main process (source of truth).
 * Updates local store + notifies subscribers for React re-render.
 */
export function clearActivityForTerminal(terminalId: TerminalId): void {
    // Phase 3: Update main process (source of truth)
    void window.electronAPI?.main.updateTerminalActivityState(terminalId, { activityCount: 0 });
    // Update local store + notify subscribers (React re-renders)
    updateTerminalActivityAndNotify(terminalId, 0);
}
