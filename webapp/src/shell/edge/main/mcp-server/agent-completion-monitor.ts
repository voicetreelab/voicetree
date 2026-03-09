/**
 * Background polling service: monitors agent completion and notifies parent via message injection.
 * Uses isAgentComplete() and buildCompletionMessage() from Phase 1.
 *
 * startMonitor() starts a setInterval loop that checks all target agents.
 * When all complete, it sends a formatted message to the caller terminal and cleans up.
 */

import type {Graph} from '@/pure/graph'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {sendTextToTerminal} from '@/shell/edge/main/terminals/send-text-to-terminal'
import {isAgentComplete, getAgentStatus} from './isAgentComplete'
import {buildCompletionMessage, type AgentResult} from './buildCompletionMessage'
import {getAgentNodes, type AgentNodeEntry} from './agentNodeIndex'
import {getNewNodesForAgent} from './getNewNodesForAgent'

type MonitorEntry = {
    intervalId: ReturnType<typeof setInterval>
    callerTerminalId: string
    terminalIds: string[]
}

const monitors: Map<string, MonitorEntry> = new Map()
let nextMonitorId: number = 1

export function startMonitor(
    callerTerminalId: string,
    terminalIds: string[],
    pollIntervalMs: number = 5000
): string {
    const monitorId: string = `monitor-${nextMonitorId++}`
    const effectiveIds: string[] = [...terminalIds, ...findExistingDescendants(terminalIds)]

    const intervalId: ReturnType<typeof setInterval> = setInterval(() => {
        const now: number = Date.now()
        const currentRecords: TerminalRecord[] = getTerminalRecords()
        const targetRecords: TerminalRecord[] = currentRecords.filter(
            (r: TerminalRecord) => effectiveIds.includes(r.terminalId)
        )
        const graph: Graph = getGraph()

        // Detect terminals that vanished from registry (should not happen after Fix 1,
        // but defend against it). Treat missing terminals as complete.
        const foundIds: Set<string> = new Set(targetRecords.map((r: TerminalRecord) => r.terminalId))
        const missingIds: string[] = effectiveIds.filter((id: string) => !foundIds.has(id))

        const allFoundDone: boolean = targetRecords.every(
            (r: TerminalRecord) => isAgentComplete(r, graph, now, currentRecords)
        )

        if (allFoundDone) {
            const results: AgentResult[] = targetRecords.map((r: TerminalRecord) => {
                const indexNodes: readonly AgentNodeEntry[] = getAgentNodes(r.terminalData.agentName)
                const graphNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(graph, r.terminalData.agentName)
                const seenIds: Set<string> = new Set(indexNodes.map((n: AgentNodeEntry) => n.nodeId))
                const mergedNodes: Array<{nodeId: string; title: string}> = [
                    ...indexNodes.map((n: AgentNodeEntry) => ({nodeId: n.nodeId, title: n.title})),
                    ...graphNodes.filter((n: {nodeId: string; title: string}) => !seenIds.has(n.nodeId))
                ]
                return {
                    terminalId: r.terminalId,
                    agentName: r.terminalData.agentName,
                    status: getAgentStatus(r),
                    exitCode: r.exitCode,
                    nodes: mergedNodes
                }
            })

            // Add entries for any terminals that vanished from registry
            for (const missingId of missingIds) {
                results.push({
                    terminalId: missingId,
                    agentName: undefined,
                    status: 'exited',
                    exitCode: null,
                    nodes: []
                })
            }

            const message: string = buildCompletionMessage(results)
            void sendTextToTerminal(callerTerminalId, message)

            clearInterval(intervalId)
            monitors.delete(monitorId)
        }
    }, pollIntervalMs)

    monitors.set(monitorId, {intervalId, callerTerminalId, terminalIds: effectiveIds})
    return monitorId
}

/**
 * Register a newly-spawned child with any active monitor that watches its parent.
 * Called from spawnTerminalWithContextNode after both headless and interactive spawn paths.
 * Transitive chains (A→B→C) work automatically: by the time C spawns, B is already
 * in the monitor's list, so C gets added too.
 */
export function registerChildIfMonitored(
    parentTerminalId: string,
    childTerminalId: string
): void {
    for (const [_monitorId, entry] of monitors) {
        if (entry.terminalIds.includes(parentTerminalId)) {
            entry.terminalIds.push(childTerminalId)
        }
    }
}

/**
 * BFS over terminal registry to find all descendants of the given parent IDs.
 * Called once in startMonitor to catch children spawned before the monitor was created.
 */
function findExistingDescendants(parentIds: string[]): string[] {
    const records: TerminalRecord[] = getTerminalRecords()
    const watched: Set<string> = new Set(parentIds)
    const descendants: string[] = []
    let changed: boolean = true
    while (changed) {
        changed = false
        for (const r of records) {
            const pid: string | null = r.terminalData.parentTerminalId
            if (pid && watched.has(pid) && !watched.has(r.terminalId)) {
                descendants.push(r.terminalId)
                watched.add(r.terminalId)
                changed = true
            }
        }
    }
    return descendants
}

export function cancelMonitor(monitorId: string): void {
    const entry: MonitorEntry | undefined = monitors.get(monitorId)
    if (entry) {
        clearInterval(entry.intervalId)
        monitors.delete(monitorId)
    }
}
