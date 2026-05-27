/**
 * MCP Tool: list_agents
 * Lists running agent terminals with their status and newly created nodes,
 * plus available agent types from settings for discovery.
 */

import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {getNodeTitle} from '@vt/graph-model/markdown'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {type McpToolResponse, buildJsonResponse} from '../../_shared/toolResponse.ts'
import {getAgentNodes} from './completion/agentNodeIndex.ts'
import {getNewNodesForAgentIdentities} from './completion/getNewNodesForAgent.ts'
import * as O from 'fp-ts/lib/Option.js'
import {getMcpGraph} from '@vt/vt-daemon/config/graphBridge.ts'
import type {GraphBridge} from '@vt/vt-daemon/config/mcpBridges.ts'
import {listPendingTerminalStates, listTerminalRecords, type PendingTerminalRecord, type TerminalRecord} from './agentControlRuntime'

function terminalRecordStatus(record: TerminalRecord): 'running' | 'idle' | 'exited' {
    return record.status === 'exited'
        ? 'exited'
        : record.terminalData.isHeadless
            ? 'running'
            : record.terminalData.isDone
                ? 'idle'
                : 'running'
}

function containedNodesForTerminalContext(
    graph: Graph,
    contextNodeId: string,
): Array<{nodeId: string; title: string}> {
    const contextNode: GraphNode | undefined = graph.nodes[contextNodeId]
    const containedNodeIds: readonly NodeIdAndFilePath[] = contextNode?.nodeUIMetadata.containedNodeIds ?? []
    return containedNodeIds.flatMap((nodeId: NodeIdAndFilePath) => {
        const node: GraphNode | undefined = graph.nodes[nodeId]
        return node ? [{nodeId, title: getNodeTitle(node)}] : []
    })
}

export async function listAgentsTool(bridge: GraphBridge): Promise<McpToolResponse> {
    const graph: Graph = await getMcpGraph(bridge)
    const agents: Array<{
        terminalId: string
        title: string
        contextNodeId: string
        status: 'running' | 'idle' | 'exited'
        exitCode: number | null
        auditRetryCount: number
        isHeadless: boolean
        isMinimized: boolean
        newNodes: Array<{nodeId: string; title: string}>
        parentTerminalId: string | null
        taskNodePath: string | null
    }> = []

    const terminalRecords: TerminalRecord[] = listTerminalRecords()
    const recordIds: Set<string> = new Set(terminalRecords.map((record: TerminalRecord) => record.terminalId))
    for (const record of terminalRecords) {
        if (record.terminalData.executeCommand !== true) {
            continue
        }

        const contextNodeId: string = record.terminalData.attachedToContextNodeId
        const agentName: string | undefined = record.terminalData.agentName

        // Find nodes created by this agent via agent_name matching (scoped to spawn time)
        const indexedNodes: readonly {readonly nodeId: string; readonly title: string}[] = getAgentNodes(record.terminalId)
        const graphMatchedNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgentIdentities(
            graph,
            [agentName, record.terminalId],
            record.spawnedAt
        )
        const containedContextNodes: Array<{nodeId: string; title: string}> = containedNodesForTerminalContext(
            graph,
            record.terminalData.attachedToContextNodeId,
        )
        const newNodesById: Map<string, {nodeId: string; title: string}> = new Map(
            [...indexedNodes, ...graphMatchedNodes, ...containedContextNodes].map((node) => [node.nodeId, node])
        )
        const newNodes: Array<{nodeId: string; title: string}> = [...newNodesById.values()]

        // Determine status: exited > idle (isDone) > running
        // isDone reflects UI green indicator (no output for a period)
        // Headless agents have no PTY, so isDone is meaningless — use process status only
        const status: 'running' | 'idle' | 'exited' = terminalRecordStatus(record)

        agents.push({
            terminalId: record.terminalId,
            title: record.terminalData.title,
            contextNodeId,
            status,
            exitCode: record.exitCode ?? null,
            auditRetryCount: record.auditRetryCount,
            isHeadless: record.terminalData.isHeadless,
            isMinimized: record.terminalData.isMinimized,
            newNodes,
            parentTerminalId: record.terminalData.parentTerminalId,
            taskNodePath: O.isSome(record.terminalData.anchoredToNodeId) ? record.terminalData.anchoredToNodeId.value : null
        })
    }

    for (const pending of listPendingTerminalStates()) {
        if (recordIds.has(pending.terminalId)) continue
        agents.push({
            terminalId: pending.terminalId,
            title: pending.terminalId,
            contextNodeId: '',
            status: 'running',
            exitCode: null,
            auditRetryCount: 0,
            isHeadless: pending.isHeadless,
            isMinimized: false,
            newNodes: [],
            parentTerminalId: null,
            taskNodePath: null
        })
    }

    // Include available agent types from settings so callers can discover
    // what agentName values are valid for spawn_agent
    const settings: VTSettings = await loadSettings()
    const availableAgents: readonly string[] = (settings?.agents ?? []).map(
        (a: { readonly name: string; readonly command: string }) => a.name
    )

    return buildJsonResponse({success: true, agents, availableAgents})
}
