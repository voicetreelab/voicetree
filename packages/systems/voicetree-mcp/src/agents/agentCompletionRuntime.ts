import {
    getHeadlessAgentOutput,
    getIdleSince,
    getPendingTerminal,
    getTerminalRecords,
    sendTextToTerminal,
    type TerminalRecord,
} from '@vt/agent-runtime'

export type {TerminalRecord}

export type PendingTerminalState = {
    readonly isHeadless: boolean
}

export function getTerminalIdleSince(terminalId: string): number | null {
    return getIdleSince(terminalId)
}

export function getPendingTerminalState(terminalId: string): PendingTerminalState | undefined {
    return getPendingTerminal(terminalId)
}

export function listTerminalRecordsSnapshot(): TerminalRecord[] {
    const records: unknown = getTerminalRecords()
    return Array.isArray(records) ? records : []
}

export function readHeadlessTerminalOutput(terminalId: string): string {
    return getHeadlessAgentOutput(terminalId)
}

export function sendTerminalText(terminalId: string, message: string): ReturnType<typeof sendTextToTerminal> {
    return sendTextToTerminal(terminalId, message)
}
