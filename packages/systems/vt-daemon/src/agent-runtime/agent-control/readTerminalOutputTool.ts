/**
 * MCP Tool: read_terminal_output
 * Reads the last N characters of output from an agent terminal.
 */

import {
    findTerminalRecord,
    getPendingTerminalState,
    readHeadlessTerminalOutput,
    readInteractiveTerminalOutput,
    terminalExists,
    type TerminalRecord,
} from './agentControlRuntime'
import {type McpToolResponse, buildJsonResponse} from '../_shared/toolResponse'

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
    if (!terminalExists(callerTerminalId)) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    // 2. Find the target terminal
    const targetRecord: TerminalRecord | undefined = findTerminalRecord(terminalId)

    if (!targetRecord) {
        // 2a. Pending terminal: spawn returned, but the PTY/process isn't registered yet.
        // No output to report — return empty with pending=true so caller can poll/retry.
        const pending: { readonly isHeadless: boolean } | undefined = getPendingTerminalState(terminalId)
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
        return buildJsonResponse({
            success: true,
            terminalId,
            nChars,
            output: readHeadlessTerminalOutput(terminalId).slice(-nChars),
            isHeadless: true
        })
    }

    // 3. Get output from character buffer
    const output: string | undefined = readInteractiveTerminalOutput(terminalId, nChars)

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
