/**
 * Get unseen nodes for a terminal by looking up its context node.
 *
 * Renderer calls: window.electronAPI.main.getUnseenNodesForTerminal(id)
 * Zero-boilerplate RPC: just add to mainAPI, types flow via Promisify.
 */

import type { NodeIdAndFilePath, GraphNode, Graph } from '@vt/graph-model/graph'
import { getNodeTitle } from '@vt/graph-model/markdown'
import { getTerminalRecords, type TerminalRecord } from '@vt/vt-daemon/terminals/terminal-registry/index.ts'
import { getRuntimeGraph, getRuntimeUnseenNodesAroundContextNode } from '@vt/vt-daemon/runtime/graph-bridge.ts'

type UnseenNode = Awaited<ReturnType<typeof getRuntimeUnseenNodesAroundContextNode>>[number]

export interface UnseenNodeInfo {
    readonly nodeId: NodeIdAndFilePath
    readonly title: string
    readonly contentPreview: string
}

const CONTENT_PREVIEW_MAX_LENGTH: number = 200

export type GetUnseenNodesDeps = {
    readonly getTerminalRecords: () => TerminalRecord[]
    readonly getGraph: () => Promise<Graph>
    readonly getUnseenNodesAroundContextNode: (contextNodeId: NodeIdAndFilePath) => Promise<readonly UnseenNode[]>
    readonly getNodeTitle: (node: GraphNode) => string
    readonly logError: (message: string, error: unknown) => void
}

const defaultGetUnseenNodesDeps: GetUnseenNodesDeps = {
    getTerminalRecords,
    getGraph: getRuntimeGraph,
    getUnseenNodesAroundContextNode: getRuntimeUnseenNodesAroundContextNode,
    getNodeTitle,
    logError: (message: string, error: unknown): void => console.error(message, error)
}

export function buildUnseenNodeInfo(
    node: UnseenNode,
    graph: Graph,
    titleForNode: (node: GraphNode) => string
): UnseenNodeInfo {
    const graphNode: GraphNode | undefined = graph.nodes[node.nodeId]
    const title: string = graphNode ? titleForNode(graphNode) : node.nodeId
    const contentPreview: string = node.content.length > CONTENT_PREVIEW_MAX_LENGTH
        ? node.content.slice(0, CONTENT_PREVIEW_MAX_LENGTH) + '...'
        : node.content

    return { nodeId: node.nodeId, title, contentPreview }
}

/**
 * Get unseen nodes near a terminal's context node.
 *
 * 1. Look up TerminalRecord by terminalId in registry
 * 2. Extract attachedToContextNodeId from terminalData
 * 3. Call existing getUnseenNodesAroundContextNode(contextNodeId)
 * 4. Return { nodeId, title, contentPreview }[]
 */
export async function getUnseenNodesForTerminal(
    terminalId: string,
    deps: GetUnseenNodesDeps = defaultGetUnseenNodesDeps
): Promise<readonly UnseenNodeInfo[]> {
    const records: TerminalRecord[] = deps.getTerminalRecords()
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
    const graph: Graph = await deps.getGraph()
    const attachedNode: GraphNode | undefined = graph.nodes[contextNodeId]
    if (!attachedNode || !attachedNode.nodeUIMetadata.isContextNode) {
        return []
    }

    try {
        const unseenNodes: readonly UnseenNode[] = await deps.getUnseenNodesAroundContextNode(contextNodeId)
        const updatedGraph: Graph = await deps.getGraph()

        return unseenNodes.map((node: UnseenNode): UnseenNodeInfo =>
            buildUnseenNodeInfo(node, updatedGraph, deps.getNodeTitle)
        )
    } catch (error: unknown) {
        deps.logError(`[get-unseen-nodes-for-terminal] Failed for terminal ${terminalId}:`, error)
        return []
    }
}
