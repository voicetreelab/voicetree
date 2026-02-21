/**
 * MCP Tool: send_message
 * Sends a message directly to an agent terminal.
 */

import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {sendTextToTerminal} from '@/shell/edge/main/terminals/send-text-to-terminal'
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

    // 2b. Guard: headless agents have no PTY/stdin — cannot receive messages
    if (targetRecord.terminalData.isHeadless) {
        return buildJsonResponse({
            success: false,
            error: `Cannot send message to headless agent "${terminalId}". Headless agents have no terminal input. They receive work via their task node and produce output as graph nodes. Use get_unseen_nodes_nearby to read their output.`
        }, true)
    }

    // 3. Send message to terminal with sender prefix
    try {
        const prefixedMessage: string = `[From: ${callerTerminalId}] ${message}\n\nIf needed, you can reply directly with the send_message tool to ${callerTerminalId}.`
        const result: Awaited<ReturnType<typeof sendTextToTerminal>> = await sendTextToTerminal(terminalId, prefixedMessage)

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
