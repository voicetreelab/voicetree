import type {Graph, GraphNode, NodeIdAndFilePath} from '@/pure/graph'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getUnseenNodesAroundContextNode, type UnseenNode} from '@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode'
import {getNodeTitle} from '@/pure/graph/markdown-parsing'
import {getTerminalManager} from './terminal-manager-instance'

import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';

export type TerminalStatus = 'running' | 'exited'

export type TerminalRecord = {
    terminalId: string
    terminalData: TerminalData
    status: TerminalStatus
}

const terminalRecords: Map<string, TerminalRecord> = new Map()

/**
 * Tracking state for unseen nodes notifications.
 * Used to implement 5-minute cooldown and avoid re-alerting about same nodes.
 */
type UnseenNodesNotificationState = {
    lastNotificationTime: number
    spawnTime: number
    alertedNodeIds: Set<NodeIdAndFilePath>
}
const notificationStateByTerminal: Map<string, UnseenNodesNotificationState> = new Map()

const NOTIFICATION_COOLDOWN_MS: number = 5 * 60 * 1000 // 5 minutes

/**
 * Push current terminal state to renderer via uiAPI.
 * Called after every mutation to keep renderer in sync.
 */
function pushStateToRenderer(): void {
    uiAPI.syncTerminals(getTerminalRecords())
}

/**
 * Notify an agent of unseen nodes created nearby while they were working.
 * Filters out nodes the agent themselves created (via agent_name matching).
 * Implements 5-minute cooldown and tracks already-alerted nodes.
 * Sends formatted list directly to terminal.
 */
async function notifyAgentOfUnseenNodes(terminalId: string, record: TerminalRecord): Promise<void> {
    try {
        const contextNodeId: NodeIdAndFilePath = record.terminalData.attachedToNodeId
        const agentName: string = record.terminalData.agentName

        // Get or initialize notification state
        let notificationState: UnseenNodesNotificationState | undefined = notificationStateByTerminal.get(terminalId)
        if (!notificationState) {
            // Should not happen since we initialize on spawn, but handle gracefully
            notificationState = {
                lastNotificationTime: 0,
                spawnTime: Date.now(),
                alertedNodeIds: new Set()
            }
            notificationStateByTerminal.set(terminalId, notificationState)
        }

        // Check 5-minute cooldown from last notification AND from spawn time
        const now: number = Date.now()
        const timeSinceLastNotification: number = now - notificationState.lastNotificationTime
        const timeSinceSpawn: number = now - notificationState.spawnTime

        if (timeSinceLastNotification < NOTIFICATION_COOLDOWN_MS || timeSinceSpawn < NOTIFICATION_COOLDOWN_MS) {
            return // Cooldown active, skip notification
        }

        // Get unseen nodes around this agent's context
        const unseenNodes: readonly UnseenNode[] = await getUnseenNodesAroundContextNode(contextNodeId)

        // Filter out nodes created by this agent
        const graph: Graph = getGraph()
        const nodesFromOthers: readonly UnseenNode[] = unseenNodes.filter((node: UnseenNode) => {
            const graphNode: GraphNode | undefined = graph.nodes[node.nodeId]
            if (!graphNode) return true
            const nodeAgentName: string | undefined = graphNode.nodeUIMetadata.additionalYAMLProps.get('agent_name')
            return nodeAgentName !== agentName
        })

        // Filter out already-alerted nodes
        const newUnseenNodes: readonly UnseenNode[] = nodesFromOthers.filter(
            (node: UnseenNode) => !notificationState.alertedNodeIds.has(node.nodeId)
        )

        if (newUnseenNodes.length === 0) return

        // Format notification message (titles and file paths only)
        const nodeList: string = newUnseenNodes.map((node: UnseenNode) => {
            const graphNode: GraphNode | undefined = graph.nodes[node.nodeId]
            const title: string = graphNode ? getNodeTitle(graphNode) : node.nodeId
            return `- ${title} (${node.nodeId})`
        }).join('\n')

        const message: string = `\n\n[VOICETREE] New nodes created nearby while you were working:\n${nodeList}\n\nReminder: If you haven't yet, create a progress tree to document your work (see addProgressTree.md).\n\n`

        // Send directly to terminal (with \r to submit as input)
        const terminalManager = getTerminalManager()
        terminalManager.write(terminalId, message + '\r')

        // Update tracking state
        notificationState.lastNotificationTime = now
        for (const node of newUnseenNodes) {
            notificationState.alertedNodeIds.add(node.nodeId)
        }
    } catch (error) {
        // Silent failure - don't disrupt normal terminal operation
        console.error(`[terminal-registry] Failed to notify agent of unseen nodes:`, error)
    }
}

export function recordTerminalSpawn(terminalId: string, terminalData: TerminalData): void {
    terminalRecords.set(terminalId, {
        terminalId,
        terminalData,
        status: 'running'
    })

    // Initialize notification tracking state for this terminal
    notificationStateByTerminal.set(terminalId, {
        lastNotificationTime: 0,
        spawnTime: Date.now(),
        alertedNodeIds: new Set()
    })

    pushStateToRenderer()
}

export function updateTerminalIsDone(terminalId: string, isDone: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }

    // Detect transition to idle (isDone: false -> true)
    const wasNotDone: boolean = !record.terminalData.isDone
    const isNowDone: boolean = isDone

    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isDone}
    })
    pushStateToRenderer()

    // Hook: Notify agent of unseen nodes when transitioning to idle
    if (wasNotDone && isNowDone) {
        void notifyAgentOfUnseenNodes(terminalId, terminalRecords.get(terminalId)!)
    }
}

export function updateTerminalPinned(terminalId: string, isPinned: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isPinned}
    })
    pushStateToRenderer()
}

/**
 * Update activity state (lastOutputTime, activityCount) in the registry.
 * Does NOT push to renderer - activity updates happen frequently and
 * should not trigger full re-renders. Renderer tracks this locally.
 */
export function updateTerminalActivityState(
    terminalId: string,
    updates: Partial<Pick<TerminalData, 'lastOutputTime' | 'activityCount'>>
): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, ...updates}
    })
    // NOTE: No pushStateToRenderer() - activity updates are high frequency
    // and should not trigger full re-renders. Renderer updates local state directly.
}

export function markTerminalExited(terminalId: string): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        status: 'exited'
    })
    pushStateToRenderer()
}

/**
 * Remove a terminal from the registry.
 * Called when terminal is closed from UI.
 * Phase 3: Ensures main registry stays in sync when renderer closes terminals.
 */
export function removeTerminalFromRegistry(terminalId: string): void {
    if (terminalRecords.has(terminalId)) {
        terminalRecords.delete(terminalId)
        // Clean up notification tracking state
        notificationStateByTerminal.delete(terminalId)
        pushStateToRenderer()
    }
}

export function getTerminalRecords(): TerminalRecord[] {
    return Array.from(terminalRecords.values())
}

/**
 * Get all existing agent names from the terminal registry.
 * Used for collision detection when spawning new terminals.
 */
export function getExistingAgentNames(): Set<string> {
    const records: TerminalRecord[] = getTerminalRecords();
    return new Set(records.map((r: TerminalRecord) => r.terminalData.agentName));
}

export function clearTerminalRecords(): void {
    terminalRecords.clear()
    notificationStateByTerminal.clear()
}

export function getNextTerminalCountForNode(nodeId: NodeIdAndFilePath): number {
    let maxCount: number = -1
    for (const record of terminalRecords.values()) {
        if (record.terminalData.attachedToNodeId === nodeId) {
            maxCount = Math.max(maxCount, record.terminalData.terminalCount)
        }
    }
    return maxCount + 1
}
