import type {TerminalData, TerminalRecord} from '@vt/vt-daemon-client'

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
 * `terminal-ui-launch` events. Shared by both edges: Electron's
 * `rehydrateTerminalPanels` (reading its main-process cache) and the browser
 * runtime's `terminal.rehydrate` (reading the `getTerminalRecords` RPC), so a
 * reload restores the same panels in either host.
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
