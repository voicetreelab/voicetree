/**
 * RPC Tool: read_terminal_output
 * Reads the last N characters of output from an agent terminal.
 */

import {
    findTerminalRecord,
    getPendingTerminalState,
    readHeadlessTerminalOutput,
    readInteractiveTerminalOutput,
    terminalExists,
    type TerminalRecord,
} from '../agentControlRuntime'
import {type ToolResponse, buildJsonResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

export interface ReadTerminalOutputParams {
    terminalId: string
    callerTerminalId: string
    nChars?: number
}

export async function readTerminalOutputTool({
    terminalId,
    callerTerminalId,
    nChars = 10000
}: ReadTerminalOutputParams): Promise<ToolResponse> {
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

    // 3. PTY output. `undefined` here means the terminal is registered but the
    //    PTY hasn't emitted anything yet — a not-yet-available state, not an
    //    error. We return the same `success: true` empty-output shape as a
    //    headless terminal with an empty buffer, so callers polling for output
    //    see "wait and retry" rather than "this command is broken". The
    //    terminal-not-found case is handled above (line 52-55) and remains an
    //    error.
    const output: string = readInteractiveTerminalOutput(terminalId, nChars) ?? ''

    return buildJsonResponse({
        success: true,
        terminalId,
        nChars,
        output,
        isHeadless: false
    })
}
