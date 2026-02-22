import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphNode, NodeIdAndFilePath} from '@/pure/graph'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getUnseenNodesAroundContextNode, type UnseenNode} from '@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode'
import {getNodeTitle} from '@/pure/graph/markdown-parsing'
import {sendTextToTerminal} from './send-text-to-terminal'

import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";
import {uiAPI} from '@/shell/edge/main/ui-api-proxy';
import {loadSettings} from '@/shell/edge/main/settings/settings_IO';

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
const STOP_HOOK_DELAY_MS: number = 30 * 1000 // 30 seconds — only notify after sustained idle

const pendingNotificationTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map()

/**
 * Shared timestamp tracking when each terminal first became idle (isDone: false→true).
 * Cleared when terminal becomes active again (isDone: true→false).
 * Used by wait_for_agents (15s threshold) and notification hook (30s setTimeout).
 */
const idleSinceByTerminal: Map<string, number> = new Map()

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
        const contextNodeId: NodeIdAndFilePath = record.terminalData.attachedToContextNodeId
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

        // Only notify about nodes in a /voice/ folder (not matching repo name like voicetree-public)
        const voiceNodes: readonly UnseenNode[] = newUnseenNodes.filter(
            (node: UnseenNode) => node.nodeId.includes('/voice/')
        )

        if (voiceNodes.length === 0) return

        // Format notification message (titles and file paths only)
        const nodeList: string = voiceNodes.map((node: UnseenNode) => {
            const graphNode: GraphNode | undefined = graph.nodes[node.nodeId]
            const title: string = graphNode ? getNodeTitle(graphNode) : node.nodeId
            return `- ${title} (${node.nodeId})`
        }).join('\n')

        const message: string = `\n\n[ voicetree-stop-hook ] New nodes created nearby while you were working:\n${nodeList}\n\nIf you don't have an up to date progress node, read addProgressTree.md to create multiple nodes to document your work.\n\n`

        // Send to terminal using escape-code + char-by-char approach
        await sendTextToTerminal(terminalId, message)

        // Update tracking state
        notificationState.lastNotificationTime = now
        for (const node of voiceNodes) {
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

/**
 * Wait N seconds, then check if the terminal is still idle before firing callback.
 * Cancels any pending timeout for this terminal if it becomes active again.
 */
function wait_for_agent_to_still_be_done_after_n_seconds(
    terminalId: string,
    delayMs: number,
    callback: (terminalId: string, record: TerminalRecord) => void
): void {
    // Clear any existing pending timeout for this terminal
    const existing: ReturnType<typeof setTimeout> | undefined = pendingNotificationTimeouts.get(terminalId)
    if (existing) clearTimeout(existing)

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
        pendingNotificationTimeouts.delete(terminalId)
        const currentRecord: TerminalRecord | undefined = terminalRecords.get(terminalId)
        if (currentRecord?.terminalData.isDone) {
            callback(terminalId, currentRecord)
        }
    }, delayMs)
    pendingNotificationTimeouts.set(terminalId, timeout)
}

function cancelPendingNotification(terminalId: string): void {
    const existing: ReturnType<typeof setTimeout> | undefined = pendingNotificationTimeouts.get(terminalId)
    if (existing) {
        clearTimeout(existing)
        pendingNotificationTimeouts.delete(terminalId)
    }
}

export function updateTerminalIsDone(terminalId: string, isDone: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }

    // Detect transition to idle (isDone: false -> true)
    const wasNotDone: boolean = !record.terminalData.isDone

    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isDone}
    })
    pushStateToRenderer()

    if (wasNotDone && isDone) {
        // Record when idle started — shared source of truth for wait_for_agents and notification hook
        idleSinceByTerminal.set(terminalId, Date.now())
        // Agent just became idle — wait 30s to confirm it's sustained before notifying
        // (only if autoNotifyUnseenNodes is enabled; disabled by default since InjectBar gives manual control)
        wait_for_agent_to_still_be_done_after_n_seconds(terminalId, STOP_HOOK_DELAY_MS, (tid, rec) => {
            void loadSettings().then((settings: import('@/pure/settings/types').VTSettings) => {
                if (settings.autoNotifyUnseenNodes) {
                    void notifyAgentOfUnseenNodes(tid, rec)
                }
            })
        })
    } else if (!isDone) {
        // Agent became active again — clear idle timestamp and cancel any pending notification
        idleSinceByTerminal.delete(terminalId)
        cancelPendingNotification(terminalId)
    }
}

export function updateTerminalMinimized(terminalId: string, isMinimized: boolean): void {
    const record: TerminalRecord | undefined = terminalRecords.get(terminalId)
    if (!record) {
        return
    }
    terminalRecords.set(terminalId, {
        ...record,
        terminalData: {...record.terminalData, isMinimized}
    })
    pushStateToRenderer()
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
        idleSinceByTerminal.delete(terminalId)
        cancelPendingNotification(terminalId)
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
    // Cancel all pending notification timeouts
    for (const timeout of pendingNotificationTimeouts.values()) {
        clearTimeout(timeout)
    }
    pendingNotificationTimeouts.clear()
    terminalRecords.clear()
    notificationStateByTerminal.clear()
    idleSinceByTerminal.clear()
}

export function getIdleSince(terminalId: string): number | null {
    return idleSinceByTerminal.get(terminalId) ?? null
}

/**
 * Get all headless agent records anchored to a given node.
 * Used by badge UI to render status badges on task node cards.
 */
export function getHeadlessAgentsForNode(nodeId: NodeIdAndFilePath): TerminalRecord[] {
    return getTerminalRecords().filter((r: TerminalRecord) =>
        r.terminalData.isHeadless &&
        O.isSome(r.terminalData.anchoredToNodeId) &&
        r.terminalData.anchoredToNodeId.value === nodeId
    )
}

export function getNextTerminalCountForNode(nodeId: NodeIdAndFilePath): number {
    let maxCount: number = -1
    for (const record of terminalRecords.values()) {
        if (record.terminalData.attachedToContextNodeId === nodeId) {
            maxCount = Math.max(maxCount, record.terminalData.terminalCount)
        }
    }
    return maxCount + 1
}
