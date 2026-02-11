/**
 * MCP Tool: get_unseen_nodes_nearby
 * Gets nodes near your context that were created after your context was generated.
 */

import type {Graph, GraphNode, NodeIdAndFilePath} from '@/pure/graph'
import {getNodeTitle} from '@/pure/graph/markdown-parsing'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getUnseenNodesAroundContextNode, type UnseenNode} from '@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {type McpToolResponse, buildJsonResponse} from './types'

export interface GetUnseenNodesNearbyParams {
    callerTerminalId: string
    search_from_node?: string
}

export async function getUnseenNodesNearbyTool({
    callerTerminalId,
    search_from_node
}: GetUnseenNodesNearbyParams): Promise<McpToolResponse> {
    // 1. Find the caller's terminal record
    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    const callerRecord: TerminalRecord | undefined = terminalRecords.find(
        (r: TerminalRecord) => r.terminalId === callerTerminalId
    )

    if (!callerRecord) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    // 2. Get the context node from the terminal
    const contextNodeId: string = callerRecord.terminalData.attachedToContextNodeId

    // 3. Get unseen nodes (with optional search_from_node override)
    const graph: Graph = getGraph()
    try {
        const unseenNodes: readonly UnseenNode[] = await getUnseenNodesAroundContextNode(
            contextNodeId,
            search_from_node as NodeIdAndFilePath | undefined
        )

        const nodes: Array<{nodeId: string; title: string}> = unseenNodes.map((node: UnseenNode) => {
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
