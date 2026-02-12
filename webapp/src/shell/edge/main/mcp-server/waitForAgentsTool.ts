/**
 * MCP Tool: wait_for_agents (async)
 * Validates inputs, starts a background monitor, and returns immediately.
 * The monitor polls agent completion and notifies the caller terminal when all agents are done.
 */

import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {type McpToolResponse, buildJsonResponse} from './types'
import {startMonitor} from './agent-completion-monitor'

export interface WaitForAgentsParams {
    terminalIds: string[]
    callerTerminalId: string
    pollIntervalMs?: number
}

export function waitForAgentsTool({
    terminalIds,
    callerTerminalId,
    pollIntervalMs = 5000,
}: WaitForAgentsParams): McpToolResponse {
    // 1. Validate caller terminal exists
    const records: TerminalRecord[] = getTerminalRecords()
    if (!records.some((r: TerminalRecord) => r.terminalId === callerTerminalId)) {
        return buildJsonResponse({success: false, error: `Unknown caller: ${callerTerminalId}`}, true)
    }

    // 2. Validate all target terminals exist
    for (const tid of terminalIds) {
        if (!records.some((r: TerminalRecord) => r.terminalId === tid)) {
            return buildJsonResponse({success: false, error: `Unknown terminal: ${tid}`}, true)
        }
    }

    // 3. Start background monitor and return immediately
    const monitorId: string = startMonitor(callerTerminalId, terminalIds, pollIntervalMs)

    return buildJsonResponse({
        monitorId,
        status: 'monitoring',
        terminalIds,
    })
}
