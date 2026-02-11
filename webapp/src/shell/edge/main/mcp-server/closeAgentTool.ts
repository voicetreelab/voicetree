/**
 * MCP Tool: close_agent
 * Closes an agent terminal.
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

export async function closeAgentTool({
    terminalId,
    callerTerminalId
}: CloseAgentParams): Promise<McpToolResponse> {
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

    // 3. Check if the agent has produced any nodes
    const agentName: string | undefined = targetRecord.terminalData.agentName
    const agentNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(getGraph(), agentName)
    if (agentNodes.length === 0) {
        return buildJsonResponse({
            success: false,
            error: `Cannot close agent terminal "${terminalId}": this agent has not produced any nodes yet. Agents should create progress nodes documenting their work before being closed.`
        }, true)
    }

    // 4. Close the terminal via UI API (mimics clicking red traffic light button)
    // This properly: removes from registry, disposes floating window, deletes context node
    try {
        uiAPI.closeTerminalById(terminalId)

        return buildJsonResponse({
            success: true,
            terminalId,
            message: `Successfully closed agent terminal: ${terminalId}`
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}
