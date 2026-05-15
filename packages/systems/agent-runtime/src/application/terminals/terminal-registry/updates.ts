import type {TerminalData} from './types'
import {
    terminalRecords,
    type TerminalRecord,
} from '../terminal-registry-state'
import {notifyRegistrySubscribers} from './subscribers'

export function updateTerminalMinimized(terminalId: string, isMinimized: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isMinimized}
    })
    notifyRegistrySubscribers()
}

export function updateTerminalPinned(terminalId: string, isPinned: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isPinned}
    })
    notifyRegistrySubscribers()
}

/**
 * Update activity state (lastOutputTime, activityCount) in the registry.
 * Does NOT push to renderer - activity updates happen frequently and
 * should not trigger full re-renders. Renderer tracks this locally.
 */
export function updateTerminalActivityState(
    terminalId: string,
    updates: Partial<Pick<TerminalData, 'lastOutputTime' | 'activityCount'>>
): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, ...updates}
    })
    // NOTE: No notifyRegistrySubscribers() - activity updates are high frequency
    // and should not trigger full re-renders. Renderer updates local state directly.
}
