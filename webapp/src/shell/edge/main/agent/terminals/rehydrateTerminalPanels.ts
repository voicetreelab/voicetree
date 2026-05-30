import type {TerminalData, TerminalRecord} from '@vt/vt-daemon-client'
import {uiAPI} from '@/shell/edge/main/runtime/ui-api-proxy'
import {getCachedTerminalRecords} from './terminal-registry-bridge'

/** A terminal that should have a floating panel, with the context node it anchors to. */
export interface RehydrateTarget {
    readonly contextNodeId: string
    readonly terminalData: TerminalData
}

/**
 * Pure core: from the terminal registry, select the terminals that should have
 * a live floating panel — every non-exited terminal that is anchored to a
 * context node. Exited terminals and any record missing an
 * `attachedToContextNodeId` are dropped.
 *
 * Keeping this pure (registry in → targets out) lets the panel set be defined
 * as a function of the durable registry rather than the transient spawn-time
 * `terminal-ui-launch` events.
 */
export function selectTerminalsToRehydrate(records: readonly TerminalRecord[]): readonly RehydrateTarget[] {
    const targets: RehydrateTarget[] = []
    for (const record of records) {
        if (record.status === 'exited') continue
        const contextNodeId: string = record.terminalData.attachedToContextNodeId
        if (!contextNodeId) continue
        targets.push({contextNodeId, terminalData: record.terminalData})
    }
    return targets
}

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
