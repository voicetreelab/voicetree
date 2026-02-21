/**
 * MCP Tool: list_agents
 * Lists running agent terminals with their status and newly created nodes.
 */

import type {Graph} from '@/pure/graph'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {type McpToolResponse, buildJsonResponse} from './types'
import {getNewNodesForAgent} from './getNewNodesForAgent'

export async function listAgentsTool(): Promise<McpToolResponse> {
    const graph: Graph = getGraph()
    const agents: Array<{
        terminalId: string
        title: string
        contextNodeId: string
        status: 'running' | 'idle' | 'exited'
        isHeadless: boolean
        newNodes: Array<{nodeId: string; title: string}>
    }> = []

    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    for (const record of terminalRecords) {
        if (record.terminalData.executeCommand !== true) {
            continue
        }

        const contextNodeId: string = record.terminalData.attachedToContextNodeId
        const agentName: string | undefined = record.terminalData.agentName

        // Find nodes created by this agent via agent_name matching
        const newNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(graph, agentName)

        // Determine status: exited > idle (isDone) > running
        // isDone reflects UI green indicator (no output for a period)
        const status: 'running' | 'idle' | 'exited' = record.status === 'exited'
            ? 'exited'
            : record.terminalData.isDone
                ? 'idle'
                : 'running'

        agents.push({
            terminalId: record.terminalId,
            title: record.terminalData.title,
            contextNodeId,
            status,
            isHeadless: record.terminalData.isHeadless,
            newNodes
        })
    }

    return buildJsonResponse({agents})
}
