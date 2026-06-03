import {terminalRuntimeSurface as agentRuntime} from '../agent-runtime/agent-control/terminalRuntimeSurface.ts'
import type {TerminalRecord, AgentStatusUpdate} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry'

export type {TerminalRecord, AgentStatusUpdate}

export function listTerminalRecords(): TerminalRecord[] {
    return agentRuntime.getTerminalRecords()
}

export function resetTerminalAuditRetryCount(terminalId: string): void {
    agentRuntime.resetAuditRetryCount(terminalId)
}

export function applyAgentStatus(terminalId: string, update: AgentStatusUpdate): void {
    agentRuntime.applyAgentStatus(terminalId, update)
}
