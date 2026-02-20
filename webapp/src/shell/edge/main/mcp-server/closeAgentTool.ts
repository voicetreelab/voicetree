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
import {uiAPI} from '@/shell/edge/main/ui-api-proxy'
import {type McpToolResponse, buildJsonResponse} from './types'
import {getNewNodesForAgent} from './getNewNodesForAgent'

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
        const agentName: string | undefined = targetRecord?.terminalData.agentName
        const agentNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(getGraph(), agentName)

        if (agentNodes.length === 0) {
            return buildJsonResponse({
                success: false,
                error: `Cannot close agent terminal "${terminalId}": this agent has not produced any nodes yet. Agents should create progress nodes documenting their work before being closed.`
            }, true)
        }
    }

    uiAPI.closeTerminalById(terminalId)
    return buildJsonResponse({
        success: true,
        terminalId,
        message: `Successfully closed agent terminal: ${terminalId}`
    })
}
