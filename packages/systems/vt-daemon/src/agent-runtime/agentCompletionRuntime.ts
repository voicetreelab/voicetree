import {terminalRuntimeSurface as agentRuntime} from './agent-control/terminalRuntimeSurface.ts'
import type {TerminalRecord} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'
import {getHeadlessAgentOutput} from './headless/headlessAgentManager.ts'
import {sendTextToTerminal} from './inject/send-text-to-terminal.ts'

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
    return getHeadlessAgentOutput(terminalId)
}

export function sendTerminalText(terminalId: string, message: string): ReturnType<typeof sendTextToTerminal> {
    return sendTextToTerminal(terminalId, message)
}
