/**
 * Pure completion-check for a single agent terminal.
 * Combines: getAgentStatus, getIdleSince.
 * Returns true when: (exited) OR (idle + idle ≥ SUSTAINED_IDLE_MS + all children complete)
 */

import type {Graph} from '@vt/graph-model/pure/graph'
import type {TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {getIdleSince} from '@/shell/edge/main/terminals/terminal-registry'

const SUSTAINED_IDLE_MS: number = 7_000 // 7 seconds — agent must be idle this long before considered done

export type AgentStatus = 'running' | 'idle' | 'exited'

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
export function isAgentComplete(record: TerminalRecord, graph: Graph, now: number, allRecords: readonly TerminalRecord[], visited?: Set<string>): boolean {
    const seen: Set<string> = visited ?? new Set()
    if (seen.has(record.terminalId)) return true // cycle — treat as complete to break recursion
    seen.add(record.terminalId)

    const status: AgentStatus = getAgentStatus(record)
    if (status === 'running') return false

    // Exited agents are immediately done (can't come back)
    if (status === 'exited') return true

    // Agent is idle — only done if sustained idle for ≥ 7s
    const idleSince: number | null = getIdleSince(record.terminalId)
    const selfComplete: boolean = idleSince !== null && (now - idleSince) >= SUSTAINED_IDLE_MS
    if (!selfComplete) return false

    // Check all child terminals are also complete (recursive, with cycle detection)
    const children: TerminalRecord[] = getChildRecords(record.terminalId, allRecords)
    return children.every((child: TerminalRecord) => isAgentComplete(child, graph, now, allRecords, seen))
}
