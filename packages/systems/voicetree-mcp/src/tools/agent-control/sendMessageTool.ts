/**
 * MCP Tool: send_message
 * Sends a message directly to an agent terminal.
 */

import {
    enqueuePendingTerminalMessage,
    findTerminalRecord,
    getPendingTerminalState,
    isTmuxHeadlessTerminal,
    sendHeadlessTerminalText,
    sendTerminalText,
    terminalExists,
    type TerminalRecord,
} from './agentControlRuntime'
import {type McpToolResponse, buildJsonResponse} from '../types'

function buildPrefixedMessage(callerTerminalId: string, message: string): string {
    return `[From: ${callerTerminalId}] ${message}\n\nIf needed, you can reply directly with the voicetree mcp send_message tool to ${callerTerminalId}. mcp__voicetree__send_message (DO NOT USE SendMessage or other messaging tools you may have, they won't work)`
}

function buildErrorResponse(error: string): McpToolResponse {
    return buildJsonResponse({
        success: false,
        error
    }, true)
}

function buildHeadlessInputError(terminalId: string): McpToolResponse {
    return buildErrorResponse(`Cannot send message to headless agent "${terminalId}". Headless agents have no terminal input. They receive work via their task node and produce output as graph nodes. Use get_unseen_nodes_nearby to read their output.`)
}

function queuePendingTerminalMessage(terminalId: string, callerTerminalId: string, message: string): McpToolResponse {
    enqueuePendingTerminalMessage(terminalId, buildPrefixedMessage(callerTerminalId, message))
    return buildJsonResponse({
        success: true,
        terminalId,
        pending: true,
        message: `Queued message for terminal "${terminalId}" — agent is still starting up. It will be delivered once the terminal is ready.`
    })
}

function handleMissingTerminal(terminalId: string, callerTerminalId: string, message: string): McpToolResponse {
    const pending: { readonly isHeadless: boolean } | undefined = getPendingTerminalState(terminalId)
    if (!pending) {
        return buildErrorResponse(`Terminal not found: ${terminalId}`)
    }
    if (pending.isHeadless) {
        return buildHeadlessInputError(terminalId)
    }
    return queuePendingTerminalMessage(terminalId, callerTerminalId, message)
}

async function sendPrefixedText(
    terminalId: string,
    callerTerminalId: string,
    message: string,
    sendText: (terminalId: string, message: string) => Promise<{success: boolean; error?: string}>,
    successMessage: string,
): Promise<McpToolResponse> {
    try {
        const prefixedMessage: string = buildPrefixedMessage(callerTerminalId, message)
        const result: Awaited<ReturnType<typeof sendText>> = await sendText(terminalId, prefixedMessage)
        if (!result.success) {
            return buildErrorResponse(result.error ?? 'Failed to send message')
        }
        return buildJsonResponse({
            success: true,
            terminalId,
            message: successMessage
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildErrorResponse(errorMessage)
    }
}

function sendInteractiveText(terminalId: string, message: string): Promise<{success: boolean; error?: string}> {
    return Promise.resolve(sendTerminalText(terminalId, message))
}

function sendMessageToInteractiveTerminal(
    terminalId: string,
    callerTerminalId: string,
    message: string,
): Promise<McpToolResponse> {
    return sendPrefixedText(
        terminalId,
        callerTerminalId,
        message,
        sendInteractiveText,
        `Successfully sent message to terminal: ${terminalId}`,
    )
}

function sendMessageToHeadlessTerminal(
    terminalId: string,
    callerTerminalId: string,
    message: string,
): Promise<McpToolResponse> | McpToolResponse {
    if (!isTmuxHeadlessTerminal(terminalId)) {
        return buildHeadlessInputError(terminalId)
    }
    return sendPrefixedText(
        terminalId,
        callerTerminalId,
        message,
        sendHeadlessTerminalText,
        `Successfully sent message to tmux-backed headless terminal: ${terminalId}`,
    )
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
        return buildErrorResponse(`Unknown caller terminal: ${callerTerminalId}`)
    }

    // 2. Find the target terminal
    const targetRecord: TerminalRecord | undefined = findTerminalRecord(terminalId)

    if (!targetRecord) {
        // 2a. Pending terminal: spawn returned, but the PTY/process isn't registered yet.
        // Queue interactive messages; reject headless (same contract as a running headless).
        return handleMissingTerminal(terminalId, callerTerminalId, message)
    }

    // 2b. Tmux-backed headless agents receive input via tmux send-keys.
    if (targetRecord.terminalData.isHeadless) {
        return sendMessageToHeadlessTerminal(terminalId, callerTerminalId, message)
    }

    // 3. Send message to terminal with sender prefix
    return sendMessageToInteractiveTerminal(terminalId, callerTerminalId, message)
}
