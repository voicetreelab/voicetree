import {
    agentRuntime,
    type TerminalRecord,
} from '@vt/agent-runtime'

export type {TerminalRecord}

export function listTerminalRecords(): TerminalRecord[] {
    return agentRuntime.getTerminalRecords()
}

export function resetTerminalAuditRetryCount(terminalId: string): void {
    agentRuntime.resetAuditRetryCount(terminalId)
}
