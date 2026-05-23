import {
    agentRuntime,
    type TerminalRecord,
} from '@vt/agent-runtime'

export type {TerminalRecord}

export type PendingTerminalState = {
    readonly isHeadless: boolean
}

export function getTerminalIdleSince(terminalId: string): number | null {
    return agentRuntime.getIdleSince(terminalId)
}

export function getPendingTerminalState(terminalId: string): PendingTerminalState | undefined {
    return agentRuntime.getPendingTerminal(terminalId)
}

export function listTerminalRecordsSnapshot(): TerminalRecord[] {
    const records: unknown = agentRuntime.getTerminalRecords()
    return Array.isArray(records) ? records : []
}

export function readHeadlessTerminalOutput(terminalId: string): string {
    return agentRuntime.getHeadlessAgentOutput(terminalId)
}

export function sendTerminalText(terminalId: string, message: string): ReturnType<typeof agentRuntime.sendTextToTerminal> {
    return agentRuntime.sendTextToTerminal(terminalId, message)
}
