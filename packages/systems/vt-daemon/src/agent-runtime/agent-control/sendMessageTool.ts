/**
 * MCP Tool: send_message
 * Sends a message directly to an agent terminal.
 *
 * Under tmux-only, every routable terminal (headless or interactive) receives
 * input through the same `tmux send-keys` mechanism. Pending terminals queue
 * the message until spawn completes; headless agents that aren't tmux-backed
 * have no input channel and are rejected.
 */

import {
    enqueuePendingTerminalMessage,
    findTerminalRecord,
    getPendingTerminalState,
    isTmuxHeadlessTerminal,
    sendTerminalText,
    terminalExists,
    type TerminalRecord,
} from './agentControlRuntime'
import {type McpToolResponse, buildJsonResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

function buildPrefixedMessage(callerTerminalId: string, message: string): string {
    return `[From: ${callerTerminalId}] ${message}\n\nIf you need to reply use the cli tool 'vt agent send' to ${callerTerminalId}. (DO NOT USE SendMessage or other messaging tools you may have, they won't work)`
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
    // All headless agents are tmux-backed. Queue the message — it will be
    // delivered once spawnTmuxBackedTerminal registers the session and drains
    // pending messages via recordTerminalSpawn.
    return queuePendingTerminalMessage(terminalId, callerTerminalId, message)
}

async function sendToTmuxTerminal(
    terminalId: string,
    callerTerminalId: string,
    message: string,
    successMessage: string,
): Promise<McpToolResponse> {
    try {
        const prefixedMessage: string = buildPrefixedMessage(callerTerminalId, message)
        const result: {success: boolean; error?: string} = await sendTerminalText(terminalId, prefixedMessage)
        if (!result.success) {
            return buildErrorResponse(result.error ?? 'Failed to send message')
        }
        return buildJsonResponse({
            success: true,
            terminalId,
            message: successMessage,
        })
    } catch (error) {
        return buildErrorResponse(error instanceof Error ? error.message : String(error))
    }
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
    if (!terminalExists(callerTerminalId)) {
        return buildErrorResponse(`Unknown caller terminal: ${callerTerminalId}`)
    }

    const targetRecord: TerminalRecord | undefined = findTerminalRecord(terminalId)

    // Pending terminal: spawn returned but the tmux session isn't registered
    // yet. Queue interactive messages; reject headless (same contract as a
    // running headless that's not tmux-backed).
    if (!targetRecord) {
        return handleMissingTerminal(terminalId, callerTerminalId, message)
    }

    // Headless agents that aren't tmux-backed have no input channel.
    if (targetRecord.terminalData.isHeadless && !isTmuxHeadlessTerminal(terminalId)) {
        return buildHeadlessInputError(terminalId)
    }

    const kind: string = targetRecord.terminalData.isHeadless ? 'tmux-backed headless terminal' : 'terminal'
    return sendToTmuxTerminal(terminalId, callerTerminalId, message, `Successfully sent message to ${kind}: ${terminalId}`)
}
