/**
 * Terminal Activity Polling - Edge layer module for tracking terminal inactivity
 *
 * Subscribes to terminal data events via IPC and marks terminals as inactive
 * after a period of no output. Uses targeted DOM updates instead of full re-renders
 * to avoid click race conditions caused by DOM destruction mid-click.
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminals, updateTerminalRunningState } from '@/shell/edge/UI-edge/state/TerminalStore';
import { isZoomSuppressed } from '@/shell/edge/UI-edge/state/AgentTabsStore';
import {
    CHECK_INTERVAL_MS,
    INACTIVITY_THRESHOLD_MS,
    isTerminalInactive,
} from '@/pure/agentTabs';
import { updateTerminalStatusDot } from '@/shell/UI/views/agentTabsDOMUpdates';
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
 * Check all terminals for inactivity and update their isDone state.
 * Uses targeted DOM update instead of full re-render.
 */
function checkTerminalInactivity(): void {
    const now: number = Date.now();
    const terminals: Map<TerminalId, TerminalData> = getTerminals();

    for (const [terminalId, terminal] of terminals) {
        const shouldBeDone: boolean = isTerminalInactive(terminal.lastOutputTime, now, INACTIVITY_THRESHOLD_MS);
        if (shouldBeDone !== terminal.isDone) {
            updateTerminalRunningState(terminalId, { isDone: shouldBeDone });
            updateTerminalStatusDot(terminalId, shouldBeDone);
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
 * - Uses targeted DOM updates (no full re-render)
 * @returns cleanup function to stop polling
 */
export function startTerminalActivityPolling(): () => void {
    // Subscribe to terminal data events
    window.electronAPI?.terminal.onData((terminalId: string, _data: string) => {
        if (isZoomSuppressed()) {
            return;
        }
        const now: number = Date.now();
        // Terminal became active - update state without triggering re-render
        const result: { terminal: TerminalData; previousIsDone: boolean } | undefined = updateTerminalRunningState(terminalId as TerminalId, {
            lastOutputTime: now,
            isDone: false,
        });
        // Only update DOM if isDone actually changed (was done, now running)
        if (result && result.previousIsDone !== false) {
            updateTerminalStatusDot(terminalId as TerminalId, false);
        }
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
