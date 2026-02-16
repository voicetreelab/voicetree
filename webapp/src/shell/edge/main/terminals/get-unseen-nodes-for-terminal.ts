/**
 * Get unseen nodes for a terminal by looking up its context node.
 *
 * Renderer calls: window.electronAPI.main.getUnseenNodesForTerminal(id)
 * Zero-boilerplate RPC: just add to mainAPI, types flow via Promisify.
 */

import type { NodeIdAndFilePath, GraphNode, Graph } from '@/pure/graph'
import { getGraph } from '@/shell/edge/main/state/graph-store'
import { getUnseenNodesAroundContextNode, type UnseenNode } from '@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'
import { getTerminalRecords, type TerminalRecord } from './terminal-registry'

export interface UnseenNodeInfo {
    readonly nodeId: NodeIdAndFilePath
    readonly title: string
    readonly contentPreview: string
}

const CONTENT_PREVIEW_MAX_LENGTH: number = 200

/**
 * Get unseen nodes near a terminal's context node.
 *
 * 1. Look up TerminalRecord by terminalId in registry
 * 2. Extract attachedToContextNodeId from terminalData
 * 3. Call existing getUnseenNodesAroundContextNode(contextNodeId)
 * 4. Return { nodeId, title, contentPreview }[]
 */
export async function getUnseenNodesForTerminal(terminalId: string): Promise<readonly UnseenNodeInfo[]> {
    const records: TerminalRecord[] = getTerminalRecords()
    const record: TerminalRecord | undefined = records.find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )

    if (!record) {
        return []
    }

    const contextNodeId: NodeIdAndFilePath = record.terminalData.attachedToContextNodeId

    // Only compute unseen nodes for terminals attached to actual context nodes
    // (those with isContextNode metadata and containedNodeIds).
    // Non-context-node terminals (e.g. the hook terminal) don't have this metadata.
    const graph: Graph = getGraph()
    const attachedNode: GraphNode | undefined = graph.nodes[contextNodeId]
    if (!attachedNode || !attachedNode.nodeUIMetadata.isContextNode) {
        return []
    }

    try {
        const unseenNodes: readonly UnseenNode[] = await getUnseenNodesAroundContextNode(contextNodeId)
        const updatedGraph: Graph = getGraph()

        return unseenNodes.map((node: UnseenNode): UnseenNodeInfo => {
            const graphNode: GraphNode | undefined = updatedGraph.nodes[node.nodeId]
            const title: string = graphNode ? getNodeTitle(graphNode) : node.nodeId
            const contentPreview: string = node.content.length > CONTENT_PREVIEW_MAX_LENGTH
                ? node.content.slice(0, CONTENT_PREVIEW_MAX_LENGTH) + '...'
                : node.content

            return { nodeId: node.nodeId, title, contentPreview }
        })
    } catch (error: unknown) {
        console.error(`[get-unseen-nodes-for-terminal] Failed for terminal ${terminalId}:`, error)
        return []
    }
}
