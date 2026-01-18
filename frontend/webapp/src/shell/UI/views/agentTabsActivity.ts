/**
 * Activity tracking for agent tabs (blue dot indicator)
 * Extracted from AgentTabsBar for modularity
 */

import * as O from 'fp-ts/lib/Option.js';
import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';
import { getTerminals, updateTerminal } from '@/shell/edge/UI-edge/state/TerminalStore';

/**
 * Mark a terminal as having activity (produced a node)
 * Checks both attachedToNodeId (context node) and anchoredToNodeId (task node)
 */
export function markTerminalActivityForContextNode(nodeId: string): void {
    const terminals: Map<TerminalId, TerminalData> = getTerminals();
    for (const [terminalId, terminal] of terminals) {
        // Check if node matches the context node (attachedToNodeId)
        if (terminal.attachedToNodeId === nodeId) {
            updateTerminal(terminalId, { activityCount: terminal.activityCount + 1 });
            console.log(`[AgentTabsBar] Marked activity for terminal ${terminalId} (context match), count: ${terminal.activityCount + 1}`);
            return;
        }
        // Check if node matches the anchored task node (anchoredToNodeId)
        if (O.isSome(terminal.anchoredToNodeId) && terminal.anchoredToNodeId.value === nodeId) {
            updateTerminal(terminalId, { activityCount: terminal.activityCount + 1 });
            console.log(`[AgentTabsBar] Marked activity for terminal ${terminalId} (anchor match), count: ${terminal.activityCount + 1}`);
            return;
        }
    }
}

/**
 * Clear activity dots for a specific terminal
 */
export function clearActivityForTerminal(terminalId: TerminalId): void {
    updateTerminal(terminalId, { activityCount: 0 });
}
