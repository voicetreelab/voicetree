/**
 * MCP Tool: close_agent
 * Closes an agent terminal — same path as clicking the red traffic light button.
 *
 * Self-close (agent closing itself): no checks, always allowed.
 * Cross-close (agent closing another): requires the target to have created
 * at least one progress node, so work isn't silently discarded.
 */

import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getTerminalRecords, removeTerminalFromRegistry, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {isHeadlessAgent, killHeadlessAgent} from '@/shell/edge/main/terminals/headlessAgentManager'
import {uiAPI} from '@/shell/edge/main/ui-api-proxy'
import {type McpToolResponse, buildJsonResponse} from './types'
import {getNewNodesForAgent} from './getNewNodesForAgent'
import {getAgentStatus} from './isAgentComplete'
import type {TerminalId} from '@/shell/edge/UI-edge/floating-windows/types'

export interface CloseAgentParams {
    terminalId: string
    callerTerminalId: string
    forceWithReason?: string
}

export function closeAgentTool({terminalId, callerTerminalId, forceWithReason}: CloseAgentParams): McpToolResponse {
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

        // Guard: refuse to close a non-idle agent unless force-overridden with reason
        const status: string = getAgentStatus(targetRecord)
        if (status === 'running' && !forceWithReason) {
            return buildJsonResponse({
                success: false,
                error: `Cannot close agent "${terminalId}": agent is still running. Send them a message first to check if they have remaining work, then retry with forceWithReason explaining why you're closing a running agent.`
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
        removeTerminalFromRegistry(terminalId)
        return buildJsonResponse({
            success: killed,
            terminalId,
            message: killed
                ? `Successfully closed headless agent: ${terminalId}`
                : `Headless agent not found: ${terminalId}`
        }, !killed)
    }

    // Already-exited headless agents: process is gone but registry record persists
    // (preserved by PR #58 for wait_for_agents). Clean up the record directly.
    const record: TerminalRecord | undefined = getTerminalRecords().find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )
    if (record?.terminalData.isHeadless && record.status === 'exited') {
        removeTerminalFromRegistry(terminalId)
        return buildJsonResponse({
            success: true,
            terminalId,
            message: `Successfully cleaned up exited headless agent: ${terminalId}`
        })
    }

    // Interactive agents: close via UI API (removes xterm.js terminal)
    uiAPI.closeTerminalById(terminalId)
    return buildJsonResponse({
        success: true,
        terminalId,
        message: `Successfully closed agent terminal: ${terminalId}`
    })
}
