/**
 * Pure completion-check for a single agent terminal.
 *
 * Completeness is decided in two layers, authoritative first:
 *   1. The agent's settled lifecycle (`completed`/`errored`) — set deterministically
 *      when the agent self-reports done via `create_graph`'s `agentStatus`, or by
 *      exit classification. This is sticky and trustworthy, so it wins outright.
 *   2. Fallback heuristic for agents that have NOT settled a lifecycle: exited, or
 *      sustained-idle past SUSTAINED_IDLE_MS with the progress-node gate satisfied.
 * Either way, an agent is only complete once all its descendant children are too.
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
import {getIdleSince as defaultGetIdleSince} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/queries.ts'
import {isFinishedLifecycle} from '@vt/vt-daemon/agent-runtime/lifecycle'
import type {TerminalRecord} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry-state.ts'

const SUSTAINED_IDLE_MS: number = 7_000 // 7 seconds — agent must be idle this long before considered done
export const NO_PROGRESS_TIMEOUT_MS: number = 30 * 60 * 1000 // 30 minutes — max time to wait for agent without progress nodes

export type AgentStatus = 'running' | 'idle' | 'exited'

/** Status union used for completion reporting — widens {@link AgentStatus} with the settled lifecycle outcomes. */
export type ReportedAgentStatus = AgentStatus | 'completed' | 'errored'

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

/**
 * Runtime status heuristic — what the PTY/process is doing right now. Used by
 * `close_agent` (don't kill an actively-running pane without force) and the
 * idle-nudge. NOT authoritative for completion: see {@link getReportedStatus}.
 */
export function getAgentStatus(record: TerminalRecord): AgentStatus {
    if (record.status === 'exited') return 'exited'
    if (record.terminalData.isHeadless) return 'running' // No PTY — isDone is meaningless
    return record.terminalData.isDone ? 'idle' : 'running'
}

/**
 * Authoritative status for completion reporting. Prefers the agent's settled
 * lifecycle (`completed`/`errored` — self-reported via `create_graph` or set by
 * exit classification) over the runtime heuristic, so a headless agent that has
 * declared itself done is never reported as still `running`.
 */
export function getReportedStatus(record: TerminalRecord): ReportedAgentStatus {
    const lifecycle = record.terminalData.lifecycle
    if (lifecycle === 'completed' || lifecycle === 'errored') return lifecycle
    return getAgentStatus(record)
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
 * Whether a single agent terminal is itself done, ignoring its children.
 *
 * Authoritative signal first: a settled lifecycle (`completed`/`errored`) is the
 * agent's own deterministic declaration (or an exit classification) and wins
 * outright — this is what lets a self-reported headless agent be detected as done
 * before its process exits, and dissolves the no-progress-node gate (declaring
 * done IS a `create_graph` call). Otherwise fall back to the runtime heuristic:
 * exited, or sustained-idle past the threshold with the progress-node gate met.
 */
function isSelfComplete(
    record: TerminalRecord,
    graph: Graph,
    now: number,
    deps: IsAgentCompleteDeps,
): boolean {
    if (isFinishedLifecycle(record.terminalData.lifecycle)) return true

    const status: AgentStatus = getAgentStatus(record)
    if (status === 'running') return false
    if (status === 'exited') return true // process gone, can't come back

    // Agent is idle — only done if sustained idle for ≥ 7s
    const idleSince: number | null = deps.getIdleSince(record.terminalId)
    if (idleSince === null || (now - idleSince) < SUSTAINED_IDLE_MS) return false

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
    return true
}

/**
 * Check if an agent and all its descendant children are complete.
 * An agent with active (non-complete) children is NOT considered complete,
 * even if the agent itself is done — it's waiting for its children to finish.
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

    if (!isSelfComplete(record, graph, now, deps)) return false

    // Check all child terminals are also complete (recursive, with cycle detection)
    const children: TerminalRecord[] = getChildRecords(record.terminalId, allRecords)
    return children.every((child: TerminalRecord) => isAgentComplete(child, graph, now, allRecords, seen, deps))
}
