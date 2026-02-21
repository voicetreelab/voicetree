/**
 * MCP Tool: read_terminal_output
 * Reads the last N characters of output from an agent terminal.
 */

import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {getOutput} from '@/shell/edge/main/terminals/terminal-output-buffer'
import {getHeadlessAgentOutput} from '@/shell/edge/main/terminals/headlessAgentManager'
import {type McpToolResponse, buildJsonResponse} from './types'

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
