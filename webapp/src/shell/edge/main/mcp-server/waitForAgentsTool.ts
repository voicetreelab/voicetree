/**
 * MCP Tool: wait_for_agents
 * Waits for specified agent terminals to complete.
 */

import type {Graph} from '@/pure/graph'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getTerminalRecords, getIdleSince, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {type McpToolResponse, buildJsonResponse} from './types'
import {getNewNodesForAgent} from './getNewNodesForAgent'

const TIMEOUT_MS: number = 1800000 // 30 minutes
const SUSTAINED_IDLE_MS: number = 30_000 // 30 seconds — agent must be idle this long before considered done (LLM agents can think for 60s+ without output)

export interface WaitForAgentsParams {
    terminalIds: string[]
    callerTerminalId: string
    pollIntervalMs?: number
}

export async function waitForAgentsTool({
    terminalIds,
    callerTerminalId,
    pollIntervalMs = 5000,
}: WaitForAgentsParams): Promise<McpToolResponse> {
    // 1. Validate caller terminal exists
    const records: TerminalRecord[] = getTerminalRecords()
    if (!records.some((r: TerminalRecord) => r.terminalId === callerTerminalId)) {
        return buildJsonResponse({success: false, error: `Unknown caller: ${callerTerminalId}`}, true)
    }

    // 2. Validate all target terminals exist
    for (const tid of terminalIds) {
        if (!records.some((r: TerminalRecord) => r.terminalId === tid)) {
            return buildJsonResponse({success: false, error: `Unknown terminal: ${tid}`}, true)
        }
    }

    // Helper to determine agent status: exited > idle (isDone) > running
    const getAgentStatus: (r: TerminalRecord) => 'running' | 'idle' | 'exited' =
        (r: TerminalRecord): 'running' | 'idle' | 'exited' =>
            r.status === 'exited' ? 'exited' : r.terminalData.isDone ? 'idle' : 'running'

    // 3. Poll until all are idle/exited AND have created nodes, or timeout reached
    const startTime: number = Date.now()
    while (Date.now() - startTime < TIMEOUT_MS) {
        const now: number = Date.now()
        const currentRecords: TerminalRecord[] = getTerminalRecords()
        const targetRecords: TerminalRecord[] = currentRecords.filter(
            (r: TerminalRecord) => terminalIds.includes(r.terminalId)
        )
        const graph: Graph = getGraph()

        const allDone: boolean = targetRecords.every((r: TerminalRecord) => {
            const status: 'running' | 'idle' | 'exited' = getAgentStatus(r)
            if (status === 'running') return false

            // Agent must also have created at least one non-context node (progress/result nodes)
            // Context nodes are auto-generated and don't represent agent work completion
            const agentName: string | undefined = r.terminalData.agentName
            const newNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(graph, agentName)
            const progressNodes: Array<{nodeId: string; title: string}> = newNodes.filter(
                (n: {nodeId: string; title: string}) => {
                    const graphNode: import('@/pure/graph').GraphNode | undefined = graph.nodes[n.nodeId]
                    return graphNode && !graphNode.nodeUIMetadata.isContextNode
                }
            )

            // Exited agents are immediately done (can't come back)
            if (status === 'exited') {
                return true
            }

            // Idle agent without progress nodes — not done yet
            if (progressNodes.length === 0) return false

            // Idle agent with progress nodes — only done if sustained idle for 30s
            const idleSince: number | null = getIdleSince(r.terminalId)
            return idleSince !== null && (now - idleSince) >= SUSTAINED_IDLE_MS
        })

        if (allDone) {
            return buildJsonResponse({
                success: true,
                agents: targetRecords.map((r: TerminalRecord) => {
                    const agentName: string | undefined = r.terminalData.agentName
                    const newNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(graph, agentName)
                    const status: 'running' | 'idle' | 'exited' = getAgentStatus(r)
                    return {
                        terminalId: r.terminalId,
                        title: r.terminalData.title,
                        status,
                        newNodes,
                        exitedWithoutNode: status === 'exited' && newNodes.length === 0
                    }
                })
            })
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    // Timeout reached - return partial results
    const finalRecords: TerminalRecord[] = getTerminalRecords()
    const targetRecords: TerminalRecord[] = finalRecords.filter(
        (r: TerminalRecord) => terminalIds.includes(r.terminalId)
    )
    const graph: Graph = getGraph()
    const stillRunning: string[] = targetRecords
        .filter((r: TerminalRecord) => getAgentStatus(r) === 'running')
        .map((r: TerminalRecord) => r.terminalId)
    const waitingForNodes: string[] = targetRecords
        .filter((r: TerminalRecord) => {
            const status: 'running' | 'idle' | 'exited' = getAgentStatus(r)
            if (status === 'running') return false
            const newNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(graph, r.terminalData.agentName)
            return newNodes.length === 0
        })
        .map((r: TerminalRecord) => r.terminalId)

    return buildJsonResponse({
        success: false,
        error: `Timeout waiting for agents after ${TIMEOUT_MS}ms`,
        stillRunning,
        waitingForNodes,
        agents: targetRecords.map((r: TerminalRecord) => {
            const agentName: string | undefined = r.terminalData.agentName
            const newNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(graph, agentName)
            const status: 'running' | 'idle' | 'exited' = getAgentStatus(r)
            return {
                terminalId: r.terminalId,
                title: r.terminalData.title,
                status,
                newNodes,
                exitedWithoutNode: status === 'exited' && newNodes.length === 0
            }
        })
    }, true)
}
