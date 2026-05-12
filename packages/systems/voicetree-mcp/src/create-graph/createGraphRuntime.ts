import {
    getTerminalRecords,
    resetAuditRetryCount,
    type TerminalRecord,
} from '@vt/agent-runtime'

export type {TerminalRecord}

export function listTerminalRecords(): TerminalRecord[] {
    return getTerminalRecords()
}

export function resetTerminalAuditRetryCount(terminalId: string): void {
    resetAuditRetryCount(terminalId)
}
