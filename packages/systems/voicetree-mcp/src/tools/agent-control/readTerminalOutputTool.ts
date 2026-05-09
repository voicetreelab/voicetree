/**
 * MCP Tool: read_terminal_output
 * Reads the last N characters of output from an agent terminal.
 */

import {
    getHeadlessAgentOutput,
    getOutput,
    getPendingTerminal,
    getTerminalRecords,
    type TerminalRecord,
} from '@vt/agent-runtime'
import {type McpToolResponse, buildJsonResponse} from '../../core/types'

export interface ReadTerminalOutputParams {
    terminalId: string
    callerTerminalId: string
    nChars?: number
}

export async function readTerminalOutputTool({
    terminalId,
    callerTerminalId,
    nChars = 10000
}: ReadTerminalOutputParams): Promise<McpToolResponse> {
    // 1. Validate caller terminal exists
    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    if (!terminalRecords.some((r: TerminalRecord) => r.terminalId === callerTerminalId)) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    // 2. Find the target terminal
    const targetRecord: TerminalRecord | undefined = terminalRecords.find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )

    if (!targetRecord) {
        // 2a. Pending terminal: spawn returned, but the PTY/process isn't registered yet.
        // No output to report — return empty with pending=true so caller can poll/retry.
        const pending: { readonly isHeadless: boolean } | undefined = getPendingTerminal(terminalId)
        if (pending) {
            return buildJsonResponse({
                success: true,
                terminalId,
                nChars,
                output: '',
                pending: true,
                isHeadless: pending.isHeadless
            })
        }
        return buildJsonResponse({
            success: false,
            error: `Terminal not found: ${terminalId}`
        }, true)
    }

    // 2b. Headless agents: return captured stdout+stderr ring buffer instead of PTY output
    if (targetRecord.terminalData.isHeadless) {
        const headlessOutput: string = getHeadlessAgentOutput(terminalId)
        return buildJsonResponse({
            success: true,
            terminalId,
            nChars,
            output: headlessOutput.slice(-nChars),
            isHeadless: true
        })
    }

    // 3. Get output from character buffer
    const output: string | undefined = getOutput(terminalId, nChars)

    if (output === undefined) {
        return buildJsonResponse({
            success: false,
            error: `No output buffer for terminal: ${terminalId}`
        }, true)
    }

    return buildJsonResponse({
        success: true,
        terminalId,
        nChars,
        output
    })
}
