/**
 * Terminal Activity Polling - Edge layer module for tracking terminal inactivity
 *
 * Subscribes to terminal data events via IPC and marks terminals as inactive
 * after a period of no output. This is side-effect heavy logic that belongs
 * in the edge layer, not the UI view.
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminals, updateTerminal } from '@/shell/edge/UI-edge/state/TerminalStore';
import { isZoomSuppressed } from '@/shell/edge/UI-edge/state/AgentTabsStore';
import {
    CHECK_INTERVAL_MS,
    INACTIVITY_THRESHOLD_MS,
    isTerminalInactive,
} from '@/pure/agentTabs';
import type {} from '@/shell/electron';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';

// =============================================================================
// Module-level state
// =============================================================================

let inactivityCheckInterval: ReturnType<typeof setInterval> | null = null;

// =============================================================================
// Inactivity Checking
// =============================================================================

/**
 * Check all terminals for inactivity and update their isDone state
 */
function checkTerminalInactivity(): void {
    const now: number = Date.now();
    const terminals: Map<TerminalId, TerminalData> = getTerminals();

    for (const [terminalId, terminal] of terminals) {
        const inactive: boolean = isTerminalInactive(terminal.lastOutputTime, now, INACTIVITY_THRESHOLD_MS);
        if (inactive !== terminal.isDone) {
            updateTerminal(terminalId, { isDone: inactive });
        }
    }
}

// =============================================================================
// Activity Polling
// =============================================================================

/**
 * Start polling for terminal activity via IPC events
 * - Subscribes to terminal.onData to detect output
 * - Runs periodic check to mark inactive terminals
 * @returns cleanup function to stop polling
 */
export function startTerminalActivityPolling(): () => void {
    // Subscribe to terminal data events
    window.electronAPI?.terminal.onData((terminalId: string, _data: string) => {
        if (isZoomSuppressed()) {
            return;
        }
        const now: number = Date.now();
        // Terminal became active - update its state
        updateTerminal(terminalId as TerminalId, {
            lastOutputTime: now,
            isDone: false,
        });
    });

    // Start interval to check for inactive terminals
    inactivityCheckInterval = setInterval(() => {
        checkTerminalInactivity();
    }, CHECK_INTERVAL_MS);

    // Return cleanup function
    return stopTerminalActivityPolling;
}

/**
 * Stop the terminal activity polling
 */
export function stopTerminalActivityPolling(): void {
    if (inactivityCheckInterval !== null) {
        clearInterval(inactivityCheckInterval);
        inactivityCheckInterval = null;
    }

    window.electronAPI?.removeAllListeners('terminal:data');
}
