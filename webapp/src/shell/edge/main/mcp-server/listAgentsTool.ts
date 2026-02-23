/**
 * MCP Tool: list_agents
 * Lists running agent terminals with their status and newly created nodes,
 * plus available agent types from settings for discovery.
 */

import type {Graph} from '@/pure/graph'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {loadSettings} from '@/shell/edge/main/settings/settings_IO'
import type {VTSettings} from '@/pure/settings'
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
        isMinimized: boolean
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
            isMinimized: record.terminalData.isMinimized,
            newNodes
        })
    }

    // Include available agent types from settings so callers can discover
    // what agentName values are valid for spawn_agent
    const settings: VTSettings = await loadSettings()
    const availableAgents: readonly string[] = (settings?.agents ?? []).map(
        (a: { readonly name: string; readonly command: string }) => a.name
    )

    return buildJsonResponse({agents, availableAgents})
}
