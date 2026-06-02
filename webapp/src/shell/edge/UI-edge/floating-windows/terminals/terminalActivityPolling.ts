/**
 * Terminal Activity Polling - Edge layer module for tracking terminal inactivity
 *
 * Tracks renderer-side terminal output (delivered via the tmux WebSocket
 * relay) and marks terminals as inactive after a period of no output. Uses
 * targeted DOM updates instead of full re-renders to avoid click race
 * conditions caused by DOM destruction mid-click.
 *
 * Output notifications come in via `notifyTerminalOutput()` — called from
 * each TerminalVanilla instance's relay `onData` handler — rather than
 * through a main-process IPC subscription. The relay client already runs
 * in the renderer, so a round-trip would be wasteful.
 */

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/anchoring/types';
import { getTerminals, updateTerminalRunningState, getActiveTerminalId } from '@/shell/edge/UI-edge/state/stores/TerminalStore';
import { isZoomSuppressed } from '@/shell/edge/UI-edge/state/stores/AgentTabsStore';
import {
    CHECK_INTERVAL_MS,
    INACTIVITY_THRESHOLD_MS,
    isTerminalInactive,
} from '@vt/graph-model/agent-tabs';
import { vanillaFloatingWindowInstances } from '@/shell/edge/UI-edge/state/stores/UIAppState';
import type { TerminalData } from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType';

// =============================================================================
// Module-level state
// =============================================================================

let inactivityCheckInterval: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;

function shouldFlipToActiveOnOutput(lifecycle: TerminalData['lifecycle']): boolean {
    return lifecycle === 'spawning' || lifecycle === 'idle' || lifecycle === 'awaiting_input';
}

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
        if (terminal.isHeadless) continue; // No PTY — inactivity check is meaningless
        const shouldBeDone: boolean = isTerminalInactive(terminal.lastOutputTime, now, INACTIVITY_THRESHOLD_MS);
        if (shouldBeDone !== terminal.isDone) {
            // Phase 3: Update main process (source of truth)
            // pushStateToRenderer in main triggers syncFromMain → React re-renders
            void window.hostAPI?.main.updateTerminalIsDone(terminalId, shouldBeDone);
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
 * Notify the activity tracker that a terminal received output.
 * Called from the renderer-side tmux relay client when bytes arrive.
 *
 * Updates the store's `lastOutputTime` so the inactivity check can flip
 * the terminal back to "active" if it had gone quiet, and routes a
 * lifecycle-aware flip-to-active through main when needed.
 *
 * The lifecycle gate consults `lifecycle` — not the legacy `isDone`
 * boolean — so freshly-spawned terminals (lifecycle='spawning',
 * isDone=false) transition out of the muted-grey 'spawning' style on
 * their first output, and so completed/errored terminals don't get
 * redundant IPC for trailing bytes.
 */
export function notifyTerminalOutput(terminalId: TerminalId): void {
    if (isZoomSuppressed()) return;
    const terminal: TerminalData | undefined = getTerminals().get(terminalId);
    if (!terminal) return;

    updateTerminalRunningState(terminalId, { lastOutputTime: Date.now() });

    if (shouldFlipToActiveOnOutput(terminal.lifecycle)) {
        void window.hostAPI?.main.updateTerminalIsDone(terminalId, false);
    }
}

/**
 * Start polling for terminal activity.
 * - Runs periodic check to mark inactive terminals
 * - Uses targeted DOM updates (no full re-render)
 *
 * Output-driven flip-to-active is delivered separately via
 * `notifyTerminalOutput()`, called from each TerminalVanilla instance.
 * @returns cleanup function to stop polling
 */
export function startTerminalActivityPolling(): () => void {
    // Start interval to check for inactive terminals
    if (!document.hidden) {
        inactivityCheckInterval = setInterval(checkTerminalInactivity, CHECK_INTERVAL_MS);
    }

    visibilityHandler = (): void => {
        if (document.hidden) {
            if (inactivityCheckInterval !== null) {
                clearInterval(inactivityCheckInterval);
                inactivityCheckInterval = null;
            }
        } else {
            if (inactivityCheckInterval === null) {
                checkTerminalInactivity();
                inactivityCheckInterval = setInterval(checkTerminalInactivity, CHECK_INTERVAL_MS);
            }
        }
    };
    document.addEventListener('visibilitychange', visibilityHandler);

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

    if (visibilityHandler !== null) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
    }
}
