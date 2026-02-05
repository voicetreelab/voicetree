/**
 * MCP Tool: send_message
 * Sends a message directly to an agent terminal.
 */

import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {getTerminalManager} from '@/shell/edge/main/terminals/terminal-manager-instance'
import {type McpToolResponse, buildJsonResponse} from './types'

export interface SendMessageParams {
    terminalId: string
    message: string
    callerTerminalId: string
}

export async function sendMessageTool({
    terminalId,
    message,
    callerTerminalId
}: SendMessageParams): Promise<McpToolResponse> {
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

    // 3. Write message to terminal (with carriage return to execute)
    try {
        const terminalManager = getTerminalManager()
        const result = terminalManager.write(terminalId, message + '\r')

        if (!result.success) {
            return buildJsonResponse({
                success: false,
                error: result.error ?? 'Failed to send message'
            }, true)
        }

        return buildJsonResponse({
            success: true,
            terminalId,
            message: `Successfully sent message to terminal: ${terminalId}`
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}
