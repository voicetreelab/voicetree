/**
 * MCP Tool: get_unseen_nodes_nearby
 * Gets nodes near your context that were created after your context was generated.
 */

import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {getNodeTitle} from '@vt/graph-model/markdown'
import {type McpToolResponse, buildJsonResponse} from '../types'
import * as O from 'fp-ts/lib/Option.js'
import {getMcpGraph, getMcpUnseenNodesAroundContextNode} from '@vt/vt-daemon/config/graphBridge.ts'
import type {GraphBridge} from '@vt/vt-daemon/config/mcpBridges.ts'
import {findTerminalRecord, listTerminalRecords, type TerminalRecord} from './agentControlRuntime'

type UnseenNode = Awaited<ReturnType<typeof getMcpUnseenNodesAroundContextNode>>[number]

export interface GetUnseenNodesNearbyParams {
    callerTerminalId: string
    search_from_node?: string
}

export async function getUnseenNodesNearbyTool(
    {
        callerTerminalId,
        search_from_node
    }: GetUnseenNodesNearbyParams,
    bridge: GraphBridge,
): Promise<McpToolResponse> {
    // 1. Find the caller's terminal record
    const terminalRecords: TerminalRecord[] = listTerminalRecords()
    const callerRecord: TerminalRecord | undefined = findTerminalRecord(callerTerminalId, terminalRecords)

    if (!callerRecord) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    // 2. Get the context node from the terminal
    const contextNodeId: string = callerRecord.terminalData.attachedToContextNodeId

    // 3. Get unseen nodes (with optional search_from_node override)
    const graph: Graph = await getMcpGraph(bridge)
    try {
        const unseenNodes: readonly UnseenNode[] = await getMcpUnseenNodesAroundContextNode(
            bridge,
            contextNodeId,
            search_from_node as NodeIdAndFilePath | undefined
        )

        // 4. Filter out nodes created by this agent and the agent's task node
        const agentName: string = callerRecord.terminalData.agentName
        const taskNodeId: NodeIdAndFilePath | undefined = O.isSome(callerRecord.terminalData.anchoredToNodeId)
            ? callerRecord.terminalData.anchoredToNodeId.value
            : undefined
        const filteredNodes: readonly UnseenNode[] = unseenNodes.filter((node: UnseenNode) => {
            // Exclude the agent's own task node
            if (taskNodeId && node.nodeId === taskNodeId) return false
            // Exclude nodes created by this agent (via agent_name YAML property)
            const graphNode: GraphNode | undefined = graph.nodes[node.nodeId]
            if (!graphNode) return true
            return graphNode.nodeUIMetadata.additionalYAMLProps['agent_name'] !== agentName
        })

        const nodes: Array<{nodeId: string; title: string}> = filteredNodes.map((node: UnseenNode) => {
            const graphNode: GraphNode | undefined = graph.nodes[node.nodeId]
            return {
                nodeId: node.nodeId,
                title: graphNode ? getNodeTitle(graphNode) : node.nodeId
            }
        })

        return buildJsonResponse({
            success: true,
            contextNodeId,
            unseenNodes: nodes
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}
