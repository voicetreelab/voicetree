import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy'
import {getCachedTerminalRecords} from './terminal-registry-bridge'
import {selectTerminalsToRehydrate} from '@/shell/agent/terminals/selectTerminalsToRehydrate'

/**
 * Impure shell: re-launch a floating terminal panel for every live terminal in
 * the registry cache.
 *
 * The set of open terminal panels is a function of the reconciled terminal
 * registry (the `.voicetree/terminals/*.json` metadata reconciled against live
 * tmux sessions — see vt-daemon `reconciliation.ts`), NOT of the one-shot
 * `terminal-ui-launch` events fired at spawn time. Those events are never
 * replayed, so anything that drops the renderer's in-memory floating-window map
 * — a Cmd+R reload, a project reopen, or opening a project that already has
 * running agents — used to leave the panels gone even though the agents were
 * still alive in tmux. This reconciles that gap.
 *
 * Idempotent: `launchTerminalOntoUI` focuses an existing window rather than
 * duplicating it, so this is safe on every renderer mount and `project:ready`.
 *
 * `skipFitAnimation: true` — a rehydration may launch many panels at once;
 * unlike a single user-initiated spawn it must not yank the viewport to each
 * one or steal focus.
 */
export function rehydrateTerminalPanels(): void {
    for (const target of selectTerminalsToRehydrate(getCachedTerminalRecords())) {
        void uiAPI.launchTerminalOntoUI(target.contextNodeId, target.terminalData, true)
    }
}
