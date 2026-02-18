/**
 * Terminal Activity Polling - Edge layer module for tracking terminal inactivity
 *
 * Subscribes to terminal data events via IPC and marks terminals as inactive
 * after a period of no output. Uses targeted DOM updates instead of full re-renders
 * to avoid click race conditions caused by DOM destruction mid-click.
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types';
import { getTerminals, updateTerminalRunningState, getActiveTerminalId } from '@/shell/edge/UI-edge/state/TerminalStore';
import { isZoomSuppressed } from '@/shell/edge/UI-edge/state/AgentTabsStore';
import {
    CHECK_INTERVAL_MS,
    INACTIVITY_THRESHOLD_MS,
    isTerminalInactive,
} from '@/pure/agentTabs';
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/UIAppState';
import type {} from '@/shell/electron';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';

// =============================================================================
// Module-level state
// =============================================================================

let inactivityCheckInterval: ReturnType<typeof setInterval> | null = null;
let unsubscribeOnData: (() => void) | null = null;

// =============================================================================
// Inactivity Checking
// =============================================================================

/**
 * Check all terminals for inactivity and update their isDone state.
 * Phase 3: Routes state changes through main process (source of truth).
 * Uses targeted DOM update for responsive UI.
 */
function checkTerminalInactivity(): void {
    const now: number = Date.now();
    const terminals: Map<TerminalId, TerminalData> = getTerminals();
    const activeId: TerminalId | null = getActiveTerminalId();

    for (const [terminalId, terminal] of terminals) {
        const shouldBeDone: boolean = isTerminalInactive(terminal.lastOutputTime, now, INACTIVITY_THRESHOLD_MS);
        if (shouldBeDone !== terminal.isDone) {
            // Phase 3: Update main process (source of truth)
            // pushStateToRenderer in main triggers syncFromMain → React re-renders
            void window.electronAPI?.main.updateTerminalIsDone(terminalId, shouldBeDone);
        }

        // Auto-scroll non-active terminals to bottom so latest output is visible.
        // Skip the active terminal — the user might be scrolling manually.
        if (terminalId !== activeId) {
            const instance: { dispose: () => void; scrollToBottom?: () => void } | undefined =
                vanillaFloatingWindowInstances.get(terminalId);
            instance?.scrollToBottom?.();
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
    unsubscribeOnData = window.electronAPI?.terminal.onData((terminalId: string, _data: string) => {
        if (isZoomSuppressed()) {
            return;
        }
        const now: number = Date.now();
        const terminals: Map<TerminalId, TerminalData> = getTerminals();
        const terminal: TerminalData | undefined = terminals.get(terminalId as TerminalId);
        if (!terminal) return;

        // Update local lastOutputTime for inactivity calculation (no IPC, no re-render)
        updateTerminalRunningState(terminalId as TerminalId, { lastOutputTime: now });

        // State transition: inactive -> active (send ONE update)
        // pushStateToRenderer in main triggers syncFromMain → React re-renders
        if (terminal.isDone) {
            void window.electronAPI?.main.updateTerminalIsDone(terminalId, false);
        }
    }) ?? null;

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

    unsubscribeOnData?.();
    unsubscribeOnData = null;
}
