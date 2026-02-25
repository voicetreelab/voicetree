/**
 * MCP Tool: close_agent
 * Closes an agent terminal — same path as clicking the red traffic light button.
 *
 * Self-close (agent closing itself): no checks, always allowed.
 * Cross-close (agent closing another): requires the target to have created
 * at least one progress node, so work isn't silently discarded.
 */

import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {isHeadlessAgent, killHeadlessAgent} from '@/shell/edge/main/terminals/headlessAgentManager'
import {uiAPI} from '@/shell/edge/main/ui-api-proxy'
import {type McpToolResponse, buildJsonResponse} from './types'
import {getNewNodesForAgent} from './getNewNodesForAgent'
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'

export interface CloseAgentParams {
    terminalId: string
    callerTerminalId: string
}

export function closeAgentTool({terminalId, callerTerminalId}: CloseAgentParams): McpToolResponse {
    const isSelfClose: boolean = callerTerminalId === terminalId

    if (!isSelfClose) {
        const targetRecord: TerminalRecord | undefined = getTerminalRecords().find(
            (r: TerminalRecord) => r.terminalId === terminalId
        )

        if (!targetRecord) {
            return buildJsonResponse({
                success: false,
                error: `Cannot close agent "${terminalId}": agent doesn't exist or has already exited.`
            }, true)
        }

        const agentName: string | undefined = targetRecord.terminalData.agentName
        const agentNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(getGraph(), agentName)

        if (agentNodes.length === 0) {
            return buildJsonResponse({
                success: false,
                error: `Cannot close agent "${terminalId}": this agent has not produced any nodes yet. Use send_message to nudge them to create a progress node or provide any other necessary guidance.`
            }, true)
        }
    }

    // Headless agents: kill child_process directly (no UI terminal to close)
    if (isHeadlessAgent(terminalId)) {
        const killed: boolean = killHeadlessAgent(terminalId as TerminalId)
        return buildJsonResponse({
            success: killed,
            terminalId,
            message: killed
                ? `Successfully closed headless agent: ${terminalId}`
                : `Headless agent not found: ${terminalId}`
        }, !killed)
    }

    // Interactive agents: close via UI API (removes xterm.js terminal)
    uiAPI.closeTerminalById(terminalId)
    return buildJsonResponse({
        success: true,
        terminalId,
        message: `Successfully closed agent terminal: ${terminalId}`
    })
}
