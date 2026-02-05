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

    // 3. Write message to terminal character by character (mimics real typing)
    // Prefix message with sender info so recipient knows who sent it
    try {
        const terminalManager = getTerminalManager()
        const prefixedMessage: string = `[From: ${callerTerminalId}] ${message}`

        // Send ESC twice to ensure we exit any mode and are in normal mode
        terminalManager.write(terminalId, '\x1b')
        await new Promise(resolve => setTimeout(resolve, 100))
        terminalManager.write(terminalId, '\x1b')
        await new Promise(resolve => setTimeout(resolve, 100))
        // Then 'i' to enter insert mode
        terminalManager.write(terminalId, 'i')
        await new Promise(resolve => setTimeout(resolve, 50))

        // Write each character with small delay to mimic typing
        const fullMessage: string = prefixedMessage + '\r'
        for (let i = 0; i < fullMessage.length; i++) {
            await new Promise(resolve => setTimeout(resolve, 5))
            const result = terminalManager.write(terminalId, fullMessage[i])
            if (!result.success) {
                return buildJsonResponse({
                    success: false,
                    error: result.error ?? 'Failed to send character'
                }, true)
            }
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
