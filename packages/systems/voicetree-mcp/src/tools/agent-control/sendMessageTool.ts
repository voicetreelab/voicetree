/**
 * MCP Tool: send_message
 * Sends a message directly to an agent terminal.
 */

import {
    enqueuePendingTerminalMessage,
    findTerminalRecord,
    getPendingTerminalState,
    sendTerminalText,
    terminalExists,
    type TerminalRecord,
} from './agentControlRuntime'
import {type McpToolResponse, buildJsonResponse} from '../../core/types'

function buildPrefixedMessage(callerTerminalId: string, message: string): string {
    return `[From: ${callerTerminalId}] ${message}\n\nIf needed, you can reply directly with the voicetree mcp send_message tool to ${callerTerminalId}. mcp__voicetree__send_message (DO NOT USE SendMessage or other messaging tools you may have, they won't work)`
}

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
        // Queue interactive messages; reject headless (same contract as a running headless).
        const pending: { readonly isHeadless: boolean } | undefined = getPendingTerminalState(terminalId)
        if (pending) {
            if (pending.isHeadless) {
                return buildJsonResponse({
                    success: false,
                    error: `Cannot send message to headless agent "${terminalId}". Headless agents have no terminal input. They receive work via their task node and produce output as graph nodes. Use get_unseen_nodes_nearby to read their output.`
                }, true)
            }
            enqueuePendingTerminalMessage(terminalId, buildPrefixedMessage(callerTerminalId, message))
            return buildJsonResponse({
                success: true,
                terminalId,
                pending: true,
                message: `Queued message for terminal "${terminalId}" — agent is still starting up. It will be delivered once the terminal is ready.`
            })
        }
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
        const prefixedMessage: string = buildPrefixedMessage(callerTerminalId, message)
        const result: Awaited<ReturnType<typeof sendTerminalText>> = await sendTerminalText(terminalId, prefixedMessage)

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
