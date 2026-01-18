/**
 * Activity tracking for agent tabs (blue dot indicator)
 * Extracted from AgentTabsBar for modularity.
 * Uses targeted DOM updates to avoid triggering full re-renders.
 */

import * as O from 'fp-ts/lib/Option.js';
import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import { getTerminals, updateTerminalRunningState } from '@/shell/edge/UI-edge/state/TerminalStore';
import { updateTerminalActivityDots } from './agentTabsDOMUpdates';

/**
 * Mark a terminal as having activity (produced a node)
 * Checks both attachedToNodeId (context node) and anchoredToNodeId (task node)
 * Uses targeted DOM update to avoid full re-render.
 */
export function markTerminalActivityForContextNode(nodeId: string): void {
    const terminals: Map<TerminalId, TerminalData> = getTerminals();
    for (const [terminalId, terminal] of terminals) {
        // Check if node matches the context node (attachedToNodeId)
        if (terminal.attachedToNodeId === nodeId) {
            const newCount: number = terminal.activityCount + 1;
            updateTerminalRunningState(terminalId, { activityCount: newCount });
            updateTerminalActivityDots(terminalId, newCount);
            console.log(`[AgentTabsBar] Marked activity for terminal ${terminalId} (context match), count: ${newCount}`);
            return;
        }
        // Check if node matches the anchored task node (anchoredToNodeId)
        if (O.isSome(terminal.anchoredToNodeId) && terminal.anchoredToNodeId.value === nodeId) {
            const newCount: number = terminal.activityCount + 1;
            updateTerminalRunningState(terminalId, { activityCount: newCount });
            updateTerminalActivityDots(terminalId, newCount);
            console.log(`[AgentTabsBar] Marked activity for terminal ${terminalId} (anchor match), count: ${newCount}`);
            return;
        }
    }
}

/**
 * Clear activity dots for a specific terminal.
 * Uses targeted DOM update to avoid full re-render.
 */
export function clearActivityForTerminal(terminalId: TerminalId): void {
    updateTerminalRunningState(terminalId, { activityCount: 0 });
    updateTerminalActivityDots(terminalId, 0);
}
