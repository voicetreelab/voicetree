/**
 * Pure completion-check for a single agent terminal.
 * Combines: getAgentStatus, getIdleSince.
 * Returns true when: (exited) OR (idle + idle ≥ SUSTAINED_IDLE_MS + all children complete)
 *
 * Deep function — internal leaf lookups (idle-since, agent-nodes,
 * new-nodes-for-agent) are injected as deps so tests can supply
 * deterministic fixtures without touching the live terminal registry or
 * the in-memory agent-node index. Production callers use the default
 * dep object that wires the leaf lookups to the in-process state.
 */

import type {Graph} from '@vt/graph-model/graph'
import {getAgentNodes as defaultGetAgentNodes} from './agentNodeIndex'
import {getNewNodesForAgent as defaultGetNewNodesForAgent} from './getNewNodesForAgent'
import {getIdleSince as defaultGetIdleSince} from '@vt/vt-daemon/terminals/terminal-registry/queries'
import type {TerminalRecord} from '@vt/vt-daemon/terminals/terminal-registry-state'

const SUSTAINED_IDLE_MS: number = 7_000 // 7 seconds — agent must be idle this long before considered done
export const NO_PROGRESS_TIMEOUT_MS: number = 30 * 60 * 1000 // 30 minutes — max time to wait for agent without progress nodes

export type AgentStatus = 'running' | 'idle' | 'exited'

export interface IsAgentCompleteDeps {
    readonly getIdleSince: (terminalId: string) => number | null
    readonly getAgentNodes: (terminalId: string) => readonly {readonly nodeId: string; readonly title: string}[]
    readonly getNewNodesForAgent: (graph: Graph, agentName: string | undefined, spawnedAt: number) => Array<{nodeId: string; title: string}>
}

export const defaultIsAgentCompleteDeps: IsAgentCompleteDeps = {
    getIdleSince: defaultGetIdleSince,
    getAgentNodes: defaultGetAgentNodes,
    getNewNodesForAgent: defaultGetNewNodesForAgent,
}

export function getAgentStatus(record: TerminalRecord): AgentStatus {
    if (record.status === 'exited') return 'exited'
    if (record.terminalData.isHeadless) return 'running' // No PTY — isDone is meaningless
    return record.terminalData.isDone ? 'idle' : 'running'
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
export function isAgentComplete(
    record: TerminalRecord,
    graph: Graph,
    now: number,
    allRecords: readonly TerminalRecord[],
    visited?: Set<string>,
    deps: IsAgentCompleteDeps = defaultIsAgentCompleteDeps,
): boolean {
    const seen: Set<string> = visited ?? new Set()
    if (seen.has(record.terminalId)) return true // cycle — treat as complete to break recursion
    seen.add(record.terminalId)

    const status: AgentStatus = getAgentStatus(record)
    if (status === 'running') return false

    // Exited agents are immediately done (can't come back)
    if (status === 'exited') return true

    // Agent is idle — only done if sustained idle for ≥ 7s
    const idleSince: number | null = deps.getIdleSince(record.terminalId)
    const selfComplete: boolean = idleSince !== null && (now - idleSince) >= SUSTAINED_IDLE_MS
    if (!selfComplete) return false

    // If agent hasn't created any progress nodes, don't consider complete —
    // it's likely still working (between tool calls or waiting on sub-agents).
    // Safety valve: after 30 minutes from spawn, consider complete anyway so orchestration doesn't hang.
    const indexNodes: readonly {readonly nodeId: string; readonly title: string}[] = deps.getAgentNodes(record.terminalId)
    const graphNodes: Array<{nodeId: string; title: string}> = deps.getNewNodesForAgent(graph, record.terminalData.agentName, record.spawnedAt)
    if (indexNodes.length === 0 && graphNodes.length === 0) {
        const aliveMs: number = now - record.spawnedAt
        if (!Number.isFinite(aliveMs) || aliveMs < NO_PROGRESS_TIMEOUT_MS) {
            return false
        }
    }

    // Check all child terminals are also complete (recursive, with cycle detection)
    const children: TerminalRecord[] = getChildRecords(record.terminalId, allRecords)
    return children.every((child: TerminalRecord) => isAgentComplete(child, graph, now, allRecords, seen, deps))
}
