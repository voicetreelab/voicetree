import * as O from 'fp-ts/lib/Option.js'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {TerminalId} from '@vt/vt-daemon-protocol'
import {clearBudget} from '../global-budget-registry'
import {publishTerminalRegistryEvent} from '../../events/terminal-registry-publisher'
import {
    idleSinceByTerminal,
    notificationStateByTerminal,
    pendingNotificationTimeouts,
    pendingTerminals,
    terminalRecords,
    type TerminalRecord,
    type TerminalRegistryTimers,
} from '../terminal-registry-state'
import {cancelPendingNotification} from './lifecycle'
import {getTerminalRecords, notifyRegistrySubscribers} from './subscribers'

/**
 * Remove a terminal from the registry.
 * Called when terminal is closed from UI.
 */
export function removeTerminalFromRegistry(terminalId: string): void {
    if (!terminalRecords.has(terminalId)) return

    terminalRecords.delete(terminalId)
    notificationStateByTerminal.delete(terminalId)
    idleSinceByTerminal.delete(terminalId)
    cancelPendingNotification(terminalId)
    clearBudget(terminalId)
    notifyRegistrySubscribers()
    publishTerminalRegistryEvent({type: 'terminal-removed', terminalId: terminalId as TerminalId})
}

/**
 * Get all existing agent names from the terminal registry.
 * Includes both running terminals and pending reservations so concurrent
 * spawns cannot pick the same name before recordTerminalSpawn runs.
 */
export function getExistingAgentNames(): Set<string> {
    const records: TerminalRecord[] = getTerminalRecords()
    const names: Set<string> = new Set(records.map((r: TerminalRecord) => r.terminalData.agentName))
    for (const pendingId of pendingTerminals.keys()) {
        names.add(pendingId)
    }
    return names
}

export function clearTerminalRecords(
    timers: Pick<TerminalRegistryTimers, 'clearTimeout'> = { clearTimeout },
): void {
    for (const timeout of pendingNotificationTimeouts.values()) {
        timers.clearTimeout(timeout)
    }
    pendingNotificationTimeouts.clear()
    terminalRecords.clear()
    pendingTerminals.clear()
    notificationStateByTerminal.clear()
    idleSinceByTerminal.clear()
}

export function getIdleSince(terminalId: string): number | null {
    return idleSinceByTerminal.get(terminalId) ?? null
}

/**
 * Get all headless agent records anchored to a given node.
 * Used by badge UI to render status badges on task node cards.
 */
export function getHeadlessAgentsForNode(nodeId: NodeIdAndFilePath): TerminalRecord[] {
    return getTerminalRecords().filter((r: TerminalRecord) =>
        r.terminalData.isHeadless &&
        O.isSome(r.terminalData.anchoredToNodeId) &&
        r.terminalData.anchoredToNodeId.value === nodeId
    )
}

export function getNextTerminalCountForNode(nodeId: NodeIdAndFilePath): number {
    let maxCount: number = -1
    for (const record of terminalRecords.values()) {
        if (record.terminalData.attachedToContextNodeId === nodeId) {
            maxCount = Math.max(maxCount, record.terminalData.terminalCount)
        }
    }
    return maxCount + 1
}
