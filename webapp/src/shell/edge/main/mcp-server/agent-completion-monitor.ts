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

    const intervalId: ReturnType<typeof setInterval> = setInterval(() => {
        const now: number = Date.now()
        const currentRecords: TerminalRecord[] = getTerminalRecords()
        const targetRecords: TerminalRecord[] = currentRecords.filter(
            (r: TerminalRecord) => terminalIds.includes(r.terminalId)
        )
        const graph: Graph = getGraph()

        const allDone: boolean = targetRecords.every(
            (r: TerminalRecord) => isAgentComplete(r, graph, now)
        )

        if (allDone) {
            const results: AgentResult[] = targetRecords.map((r: TerminalRecord) => ({
                terminalId: r.terminalId,
                agentName: r.terminalData.agentName,
                status: getAgentStatus(r),
                nodes: getNewNodesForAgent(graph, r.terminalData.agentName)
            }))

            const message: string = buildCompletionMessage(results)
            void sendTextToTerminal(callerTerminalId, message)

            clearInterval(intervalId)
            monitors.delete(monitorId)
        }
    }, pollIntervalMs)

    monitors.set(monitorId, {intervalId, callerTerminalId, terminalIds})
    return monitorId
}

export function cancelMonitor(monitorId: string): void {
    const entry: MonitorEntry | undefined = monitors.get(monitorId)
    if (entry) {
        clearInterval(entry.intervalId)
        monitors.delete(monitorId)
    }
}
