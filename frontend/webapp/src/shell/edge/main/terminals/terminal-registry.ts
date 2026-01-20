import type {NodeIdAndFilePath} from '@/pure/graph'

import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';

export type TerminalStatus = 'running' | 'exited'

export type TerminalRecord = {
    terminalId: string
    terminalData: TerminalData
    status: TerminalStatus
}

const terminalRecords: Map<string, TerminalRecord> = new Map()

/**
 * Push current terminal state to renderer via uiAPI.
 * Called after every mutation to keep renderer in sync.
 */
function pushStateToRenderer(): void {
    uiAPI.syncTerminals(getTerminalRecords())
}

export function recordTerminalSpawn(terminalId: string, terminalData: TerminalData): void {
    terminalRecords.set(terminalId, {
        terminalId,
        terminalData,
        status: 'running'
    })
    pushStateToRenderer()
}

export function updateTerminalIsDone(terminalId: string, isDone: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isDone}
    })
    pushStateToRenderer()
}

export function updateTerminalPinned(terminalId: string, isPinned: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isPinned}
    })
    pushStateToRenderer()
}

export function updateTerminalActivityState(
    terminalId: string,
    updates: Partial<Pick<TerminalData, 'lastOutputTime' | 'activityCount'>>
): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, ...updates}
    })
    pushStateToRenderer()
}

export function markTerminalExited(terminalId: string): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        status: 'exited'
    })
    pushStateToRenderer()
}

/**
 * Remove a terminal from the registry.
 * Called when terminal is closed from UI.
 * Phase 3: Ensures main registry stays in sync when renderer closes terminals.
 */
export function removeTerminalFromRegistry(terminalId: string): void {
    if (terminalRecords.has(terminalId)) {
        terminalRecords.delete(terminalId)
        pushStateToRenderer()
    }
}

export function getTerminalRecords(): TerminalRecord[] {
    return Array.from(terminalRecords.values())
}

export function clearTerminalRecords(): void {
    terminalRecords.clear()
}

export function getNextTerminalCountForNode(nodeId: NodeIdAndFilePath): number {
    let maxCount: number = -1
    for (const record of terminalRecords.values()) {
        if (record.terminalData.attachedToNodeId === nodeId) {
            maxCount = Math.max(maxCount, record.terminalData.terminalCount)
        }
    }
    return maxCount + 1
}
