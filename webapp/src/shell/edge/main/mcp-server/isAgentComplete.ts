/**
 * Pure completion-check for a single agent terminal.
 * Combines: getAgentStatus, getIdleSince, getNewNodesForAgent, filterOutContextNodes.
 * Returns true when: (exited) OR (idle + has non-context nodes + idle ≥ SUSTAINED_IDLE_MS)
 */

import type {Graph, GraphNode} from '@/pure/graph'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {getIdleSince} from '@/shell/edge/main/terminals/terminal-registry'
import {getNewNodesForAgent} from './getNewNodesForAgent'

const SUSTAINED_IDLE_MS: number = 7_000 // 7 seconds — agent must be idle this long before considered done

export type AgentStatus = 'running' | 'idle' | 'exited'

export function getAgentStatus(record: TerminalRecord): AgentStatus {
    return record.status === 'exited' ? 'exited' : record.terminalData.isDone ? 'idle' : 'running'
}

function filterOutContextNodes(
    nodes: Array<{nodeId: string; title: string}>,
    graph: Graph
): Array<{nodeId: string; title: string}> {
    return nodes.filter((n: {nodeId: string; title: string}) => {
        const graphNode: GraphNode | undefined = graph.nodes[n.nodeId]
        return graphNode && !graphNode.nodeUIMetadata.isContextNode
    })
}

export function isAgentComplete(record: TerminalRecord, graph: Graph, now: number): boolean {
    const status: AgentStatus = getAgentStatus(record)
    if (status === 'running') return false

    // Exited agents are immediately done (can't come back)
    if (status === 'exited') return true

    // Agent is idle — check if it has non-context progress nodes
    const newNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(graph, record.terminalData.agentName)
    const progressNodes: Array<{nodeId: string; title: string}> = filterOutContextNodes(newNodes, graph)

    // Idle agent without progress nodes — not done yet
    if (progressNodes.length === 0) return false

    // Idle agent with progress nodes — only done if sustained idle for ≥ 30s
    const idleSince: number | null = getIdleSince(record.terminalId)
    return idleSince !== null && (now - idleSince) >= SUSTAINED_IDLE_MS
}
