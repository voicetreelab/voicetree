import type {NodeIdAndFilePath} from '@/pure/graph'

import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

export type TerminalStatus = 'running' | 'exited'

export type TerminalRecord = {
    terminalId: string
    terminalData: TerminalData
    status: TerminalStatus
}

const terminalRecords: Map<string, TerminalRecord> = new Map()

export function recordTerminalSpawn(terminalId: string, terminalData: TerminalData): void {
    terminalRecords.set(terminalId, {
        terminalId,
        terminalData,
        status: 'running'
    })
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
