/**
 * Background polling service: monitors agent completion and notifies parent via message injection.
 * Uses isAgentComplete() and buildCompletionMessage() from Phase 1.
 *
 * startMonitor() starts a setInterval loop that checks all target agents.
 * When all complete, it sends a formatted message to the caller terminal and cleans up.
 */

import type {Graph} from '@vt/graph-model/graph'
import {
    getPendingTerminalState,
    listTerminalRecordsSnapshot,
    readHeadlessTerminalOutput,
    sendTerminalText,
    type TerminalRecord,
} from '../agentCompletionRuntime.ts'
import {
    isAgentComplete,
    getAgentStatus,
} from './completion/isAgentComplete.ts'
import {
    buildCompletionMessage,
    type AgentResult,
} from './completion/buildCompletionMessage.ts'
import {
    getAgentNodes,
    type AgentNodeEntry,
} from './completion/agentNodeIndex.ts'
import {getNewNodesForAgent} from './completion/getNewNodesForAgent.ts'
import {getToolGraph} from '@vt/vt-daemon/config/graphBridge.ts'
import type {GraphBridge} from '@vt/vt-daemon/config/toolBridges.ts'

type MonitorEntry = {
    intervalId: ReturnType<typeof setInterval>
    callerTerminalId: string
    terminalIds: string[]
}

const monitors: Map<string, MonitorEntry> = new Map()
let nextMonitorId: number = 1

function startMonitorInterval(
    callback: () => void,
    pollIntervalMs: number
): ReturnType<typeof setInterval> {
    return setInterval(callback, pollIntervalMs)
}

function stopMonitorInterval(intervalId: ReturnType<typeof setInterval>): void {
    clearInterval(intervalId)
}

function getCurrentTimeMs(): number {
    return Date.now()
}

export interface AgentCompletionMonitorDeps {
    readonly setInterval: (callback: () => void, pollIntervalMs: number) => ReturnType<typeof setInterval>
    readonly clearInterval: (intervalId: ReturnType<typeof setInterval>) => void
    readonly now: () => number
    readonly getNewNodesForAgent: typeof getNewNodesForAgent
}

const defaultAgentCompletionMonitorDeps: AgentCompletionMonitorDeps = {
    setInterval: startMonitorInterval,
    clearInterval: stopMonitorInterval,
    now: getCurrentTimeMs,
    getNewNodesForAgent,
}

export function startMonitor(
    callerTerminalId: string,
    terminalIds: string[],
    bridge: GraphBridge,
    pollIntervalMs: number = 5000,
    deps: AgentCompletionMonitorDeps = defaultAgentCompletionMonitorDeps
): string {
    const monitorId: string = `monitor-${nextMonitorId++}`
    const effectiveIds: string[] = [...terminalIds, ...findExistingDescendants(terminalIds)]

    const intervalId: ReturnType<typeof setInterval> = deps.setInterval(() => { void (async () => {
        try {
        const now: number = deps.now()
        const currentRecords: TerminalRecord[] = listTerminalRecordsSnapshot()
        const targetRecords: TerminalRecord[] = currentRecords.filter(
            (r: TerminalRecord) => effectiveIds.includes(r.terminalId)
        )
        const graph: Graph = await getToolGraph(bridge)

        // Detect terminals that vanished from registry (should not happen after Fix 1,
        // but defend against it). Treat missing terminals as complete.
        const foundIds: Set<string> = new Set(targetRecords.map((r: TerminalRecord) => r.terminalId))
        const unfoundIds: string[] = effectiveIds.filter((id: string) => !foundIds.has(id))

        // Pending terminals (spawn_agent returned but recordTerminalSpawn hasn't fired yet)
        // are still mid-startup, NOT vanished — wait for them. Truly-missing IDs (neither
        // running nor pending) keep their original "treat as complete" semantics.
        const stillPendingIds: string[] = unfoundIds.filter((id: string) => getPendingTerminalState(id) !== undefined)
        const missingIds: string[] = unfoundIds.filter((id: string) => getPendingTerminalState(id) === undefined)

        if (stillPendingIds.length > 0) {
            return // Wait for pending spawns to either register or be cleared.
        }

        const allFoundDone: boolean = targetRecords.every(
            (r: TerminalRecord) => isAgentComplete(r, graph, now, currentRecords)
        )

        if (allFoundDone) {
            // Nudge agents that completed via the 30-min no-progress timeout
            for (const r of targetRecords) {
                const agentStatus: string = getAgentStatus(r)
                if (agentStatus === 'idle') {
                    const indexNodes: readonly AgentNodeEntry[] = getAgentNodes(r.terminalId)
                    const graphNodes: Array<{nodeId: string; title: string}> = deps.getNewNodesForAgent(graph, r.terminalData.agentName, r.spawnedAt)
                    if (indexNodes.length === 0 && graphNodes.length === 0) {
                        void sendTerminalText(r.terminalId,
                            '\n\n[WaitForAgents] You have been idle for over 30 minutes without creating progress nodes. ' +
                            'Please create progress nodes documenting your work. Read addProgressTree.md for guidance.\n\n'
                        )
                    }
                }
            }

            const results: AgentResult[] = targetRecords.map((r: TerminalRecord) => {
                const indexNodes: readonly AgentNodeEntry[] = getAgentNodes(r.terminalId)
                const graphNodes: Array<{nodeId: string; title: string}> = deps.getNewNodesForAgent(graph, r.terminalData.agentName, r.spawnedAt)
                const seenIds: Set<string> = new Set(indexNodes.map((n: AgentNodeEntry) => n.nodeId))
                const mergedNodes: Array<{nodeId: string; title: string}> = [
                    ...indexNodes.map((n: AgentNodeEntry) => ({nodeId: n.nodeId, title: n.title})),
                    ...graphNodes.filter((n: {nodeId: string; title: string}) => !seenIds.has(n.nodeId))
                ]
                const failed: boolean = r.exitCode !== null && r.exitCode !== 0
                const lastOutput: string | undefined = failed
                    ? readHeadlessTerminalOutput(r.terminalId).slice(-200).trim() || undefined
                    : undefined
                return {
                    terminalId: r.terminalId,
                    agentName: r.terminalData.agentName,
                    status: getAgentStatus(r),
                    exitCode: r.exitCode,
                    nodes: mergedNodes,
                    lastOutput
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

            const stillWaitingOn: string[] = await getPendingAgentNamesForCaller(callerTerminalId, monitorId, bridge)
            const message: string = buildCompletionMessage(results, stillWaitingOn)
            void sendTerminalText(callerTerminalId, message)

            deps.clearInterval(intervalId)
            monitors.delete(monitorId)
        }
        } catch (e: unknown) {
            console.warn('[agent-completion-monitor] poll error:', e)
        }
    })() }, pollIntervalMs)

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
    const records: TerminalRecord[] = listTerminalRecordsSnapshot()
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

/**
 * Returns agent names still being monitored for this caller, excluding the monitor that just fired.
 * Used by auto-wait to show "Still waiting on: X, Y" hints in per-agent completion messages.
 */
export async function getPendingAgentNamesForCaller(callerTerminalId: string, excludeMonitorId: string, bridge: GraphBridge): Promise<string[]> {
    const currentRecords: TerminalRecord[] = listTerminalRecordsSnapshot()
    const graph: Graph = await getToolGraph(bridge)
    const now: number = Date.now()
    const names: string[] = []
    for (const [monitorId, entry] of monitors) {
        if (monitorId === excludeMonitorId) continue
        if (entry.callerTerminalId !== callerTerminalId) continue
        for (const tid of entry.terminalIds) {
            const record: TerminalRecord | undefined = currentRecords.find(
                (r: TerminalRecord) => r.terminalId === tid
            )
            if (record && !isAgentComplete(record, graph, now, currentRecords)) {
                names.push(record.terminalData.agentName ?? record.terminalId)
            }
        }
    }
    return names
}

export function isTerminalIdAlreadyMonitoredForCaller(
    callerTerminalId: string,
    terminalId: string
): boolean {
    for (const [_monitorId, entry] of monitors) {
        if (entry.callerTerminalId !== callerTerminalId) continue
        if (entry.terminalIds.includes(terminalId)) {
            return true
        }
    }
    return false
}

export function cancelMonitor(monitorId: string): void {
    const entry: MonitorEntry | undefined = monitors.get(monitorId)
    if (entry) {
        defaultAgentCompletionMonitorDeps.clearInterval(entry.intervalId)
        monitors.delete(monitorId)
    }
}
