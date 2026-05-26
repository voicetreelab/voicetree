import type {TerminalId} from '@vt/vt-daemon-protocol'
import type {TerminalData} from './types'
import {publishTerminalRegistryEvent} from '../../events/terminal-registry-publisher'
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
    publishTerminalRegistryEvent({
        type: 'terminal-record-changed',
        terminalId: terminalId as TerminalId,
        patch: {kind: 'minimized', value: isMinimized},
    })
}

export function updateTerminalPinned(terminalId: string, isPinned: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) return
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isPinned}
    })
    notifyRegistrySubscribers()
    publishTerminalRegistryEvent({
        type: 'terminal-record-changed',
        terminalId: terminalId as TerminalId,
        patch: {kind: 'pinned', value: isPinned},
    })
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
    publishTerminalRegistryEvent({
        type: 'terminal-record-changed',
        terminalId: terminalId as TerminalId,
        patch: {
            kind: 'activity',
            value: {
                ...(updates.lastOutputTime !== undefined ? {lastOutputTime: updates.lastOutputTime} : {}),
                ...(updates.activityCount !== undefined ? {activityCount: updates.activityCount} : {}),
            },
        },
    })
}
