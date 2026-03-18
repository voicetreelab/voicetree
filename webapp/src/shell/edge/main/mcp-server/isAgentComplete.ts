/**
 * Pure completion-check for a single agent terminal.
 * Combines: getAgentStatus, getIdleSince, getNewNodesForAgent, filterOutContextNodes.
 * Returns true when: (exited) OR (idle + has non-context nodes + idle ≥ SUSTAINED_IDLE_MS + all children complete)
 */

import type {Graph, GraphNode} from '@/pure/graph'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {getIdleSince} from '@/shell/edge/main/terminals/terminal-registry'
import {getNewNodesForAgent} from './getNewNodesForAgent'

const SUSTAINED_IDLE_MS: number = 7_000 // 7 seconds — agent must be idle this long before considered done

export type AgentStatus = 'running' | 'idle' | 'exited'

export function getAgentStatus(record: TerminalRecord): AgentStatus {
    if (record.status === 'exited') return 'exited'
    if (record.terminalData.isHeadless) return 'running' // No PTY — isDone is meaningless
    return record.terminalData.isDone ? 'idle' : 'running'
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

/**
 * Find all child terminals of a given terminal (via parentTerminalId).
 */
function getChildRecords(parentId: string, allRecords: readonly TerminalRecord[]): TerminalRecord[] {
    return allRecords.filter(
        (r: TerminalRecord) => r.terminalData.parentTerminalId === parentId
    )
}

/**
 * Check if an agent and all its descendant children are complete.
 * An agent with active (non-complete) children is NOT considered complete,
 * even if the agent itself is idle — it's waiting for its children to finish.
 *
 * Uses a visited set to prevent infinite recursion from cycles in the
 * parent-child graph (e.g., replaceSelf creating terminalId === parentTerminalId).
 */
export function isAgentComplete(record: TerminalRecord, graph: Graph, now: number, allRecords: readonly TerminalRecord[], visited?: Set<string>): boolean {
    const seen: Set<string> = visited ?? new Set()
    if (seen.has(record.terminalId)) return true // cycle — treat as complete to break recursion
    seen.add(record.terminalId)

    const status: AgentStatus = getAgentStatus(record)
    if (status === 'running') return false

    // Exited agents are immediately done (can't come back)
    if (status === 'exited') return true

    // Agent is idle — check if it has non-context progress nodes
    const newNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(graph, record.terminalData.agentName, record.spawnedAt)
    const progressNodes: Array<{nodeId: string; title: string}> = filterOutContextNodes(newNodes, graph)

    // Idle agent without progress nodes — not done yet
    if (progressNodes.length === 0) return false

    // Idle agent with progress nodes — only done if sustained idle for ≥ 7s
    const idleSince: number | null = getIdleSince(record.terminalId)
    const selfComplete: boolean = idleSince !== null && (now - idleSince) >= SUSTAINED_IDLE_MS
    if (!selfComplete) return false

    // Check all child terminals are also complete (recursive, with cycle detection)
    const children: TerminalRecord[] = getChildRecords(record.terminalId, allRecords)
    return children.every((child: TerminalRecord) => isAgentComplete(child, graph, now, allRecords, seen))
}
