import {terminalRuntimeSurface as agentRuntime} from '../tools/agent-control/terminalRuntimeSurface.ts'
import type {TerminalRecord} from '@vt/vt-daemon/terminals/terminal-registry'

export type {TerminalRecord}

export function listTerminalRecords(): TerminalRecord[] {
    return agentRuntime.getTerminalRecords()
}

export function resetTerminalAuditRetryCount(terminalId: string): void {
    agentRuntime.resetAuditRetryCount(terminalId)
}
