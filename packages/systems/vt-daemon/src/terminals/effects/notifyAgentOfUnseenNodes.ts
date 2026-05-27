import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {getNodeTitle} from '@vt/graph-model/markdown'
import {sendTextToTerminal} from '@vt/agent-runtime/inject/send-text-to-terminal.ts'
import {
    getRuntimeGraph,
    getRuntimeUnseenNodesAroundContextNode,
} from '@vt/vt-daemon/runtime/graph-bridge.ts'
import {
    NOTIFICATION_COOLDOWN_MS,
    notificationStateByTerminal,
    type TerminalRecord,
    type TerminalRegistryClock,
    type TerminalRegistryLogger,
    type UnseenNodesNotificationState,
} from '../terminal-registry-state.ts'

type UnseenNode = Awaited<ReturnType<typeof getRuntimeUnseenNodesAroundContextNode>>[number]

const defaultNotificationDeps: TerminalRegistryClock & { logger: TerminalRegistryLogger } = {
    now: Date.now,
    logger: { info: console.log, error: console.error },
}

function getOrCreateNotificationState(
    terminalId: string,
    deps: TerminalRegistryClock,
): UnseenNodesNotificationState {
    const existing: UnseenNodesNotificationState | undefined = notificationStateByTerminal.get(terminalId)
    if (existing) return existing
    const created: UnseenNodesNotificationState = {
        lastNotificationTime: 0,
        spawnTime: deps.now(),
        alertedNodeIds: new Set()
    }
    notificationStateByTerminal.set(terminalId, created)
    return created
}

export async function notifyAgentOfUnseenNodes(
    terminalId: string,
    record: TerminalRecord,
    deps: TerminalRegistryClock & { logger: TerminalRegistryLogger } = defaultNotificationDeps,
): Promise<void> {
    try {
        const contextNodeId: NodeIdAndFilePath = record.terminalData.attachedToContextNodeId
        const agentName: string = record.terminalData.agentName

        const notificationState: UnseenNodesNotificationState = getOrCreateNotificationState(terminalId, deps)

        const now: number = deps.now()
        const timeSinceLastNotification: number = now - notificationState.lastNotificationTime
        const timeSinceSpawn: number = now - notificationState.spawnTime

        if (timeSinceLastNotification < NOTIFICATION_COOLDOWN_MS || timeSinceSpawn < NOTIFICATION_COOLDOWN_MS) {
            return
        }

        const unseenNodes: readonly UnseenNode[] = await getRuntimeUnseenNodesAroundContextNode(contextNodeId)
        const graph: Graph = await getRuntimeGraph()
        const nodesFromOthers: readonly UnseenNode[] = unseenNodes.filter((node: UnseenNode) => {
            const graphNode: GraphNode | undefined = graph.nodes[node.nodeId]
            if (!graphNode) return true
            return graphNode.nodeUIMetadata.additionalYAMLProps['agent_name'] !== agentName
        })

        const newUnseenNodes: readonly UnseenNode[] = nodesFromOthers.filter(
            (node: UnseenNode) => !notificationState.alertedNodeIds.has(node.nodeId)
        )
        const voiceNodes: readonly UnseenNode[] = newUnseenNodes.filter(
            (node: UnseenNode) => node.nodeId.includes('/voice/')
        )

        if (voiceNodes.length === 0) return

        const nodeList: string = voiceNodes.map((node: UnseenNode) => {
            const graphNode: GraphNode | undefined = graph.nodes[node.nodeId]
            const title: string = graphNode ? getNodeTitle(graphNode) : node.nodeId
            return `- ${title} (${node.nodeId})`
        }).join('\n')

        const message: string = `\n\n[ voicetree-stop-hook ] New nodes created nearby while you were working:\n${nodeList}\n\nIf you don't have an up to date progress node, read addProgressTree.md to create multiple nodes to document your work.\n\n`
        await sendTextToTerminal(terminalId, message)

        notificationState.lastNotificationTime = now
        for (const node of voiceNodes) {
            notificationState.alertedNodeIds.add(node.nodeId)
        }
    } catch (error) {
        deps.logger.error(`[terminal-registry] Failed to notify agent of unseen nodes:`, error)
    }
}
