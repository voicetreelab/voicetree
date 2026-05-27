import {terminalRuntimeSurface as agentRuntime} from '../agent-runtime/agent-control/terminalRuntimeSurface.ts'
import type {TerminalRecord} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'

export type {TerminalRecord}

export function listTerminalRecords(): TerminalRecord[] {
    return agentRuntime.getTerminalRecords()
}

export function resetTerminalAuditRetryCount(terminalId: string): void {
    agentRuntime.resetAuditRetryCount(terminalId)
}
