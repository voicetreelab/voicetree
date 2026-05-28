/**
 * Inject selected node title + filepath into an agent terminal PTY and mark them as seen.
 *
 * Renderer calls: window.electronAPI.main.injectNodesIntoTerminal(id, nodeIds)
 * Zero-boilerplate RPC: just add to mainAPI, types flow via Promisify.
 */

import type { NodeIdAndFilePath, Graph, GraphNode } from '@vt/graph-model/graph'
import { getNodeTitle } from '@vt/graph-model/markdown'
import { sendTextToTerminal } from './send-text-to-terminal'
import { getTerminalRecords, type TerminalRecord } from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/index.ts'
import { getRuntimeGraph, runtimeUpdateContextNodeContainedIds } from '@vt/vt-daemon/agent-runtime/runtime/graph-bridge.ts'

const MAX_NODES_PER_INJECTION: number = 5

export type InjectNodesDeps = {
    readonly getTerminalRecords: () => TerminalRecord[]
    readonly getGraph: () => Promise<Graph>
    readonly getNodeTitle: (node: GraphNode) => string
    readonly sendTextToTerminal: (terminalId: string, text: string) => Promise<{ success: boolean }>
    readonly updateContextNodeContainedIds: (contextNodeId: NodeIdAndFilePath, nodeIds: readonly string[]) => Promise<unknown>
    readonly logError: (message: string, error: unknown) => void
}

const defaultInjectNodesDeps: InjectNodesDeps = {
    getTerminalRecords,
    getGraph: getRuntimeGraph,
    getNodeTitle,
    sendTextToTerminal,
    updateContextNodeContainedIds: runtimeUpdateContextNodeContainedIds,
    logError: (message: string, error: unknown): void => console.error(message, error)
}

export function buildNodeInjectionPayload(
    nodeIds: readonly string[],
    graph: Graph,
    titleForNode: (node: GraphNode) => string
): { readonly payload: string; readonly injectedCount: number } {
    const nodeBlocks: string[] = []
    for (const nodeId of nodeIds) {
        const graphNode: GraphNode | undefined = graph.nodes[nodeId]
        if (!graphNode) continue

        const title: string = titleForNode(graphNode)
        nodeBlocks.push(`- ${title} (${nodeId})`)
    }

    if (nodeBlocks.length === 0) {
        return { payload: '', injectedCount: 0 }
    }

    return {
        payload: `\nPlease check these nodes that were created while you were working:\n\n${nodeBlocks.join('\n\n')}\n`,
        injectedCount: nodeBlocks.length
    }
}

/**
 * Inject node title + filepath into a terminal and mark the nodes as seen in the context node.
 *
 * 1. For each nodeId, get node title from graph
 * 2. Format as injection payload (plain text list of title + filepath)
 * 3. Batch into single sendTextToTerminal call to avoid PTY flooding
 * 4. Update context node's containedNodeIds to include injected nodeIds (mark seen)
 * 5. Return success response
 */
export async function injectNodesIntoTerminal(
    terminalId: string,
    nodeIds: readonly string[],
    deps: InjectNodesDeps = defaultInjectNodesDeps
): Promise<{ success: boolean; injectedCount: number }> {
    const records: TerminalRecord[] = deps.getTerminalRecords()
    const record: TerminalRecord | undefined = records.find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )

    if (!record) {
        return { success: false, injectedCount: 0 }
    }

    const contextNodeId: NodeIdAndFilePath = record.terminalData.attachedToContextNodeId
    const graph: Graph = await deps.getGraph()

    // Cap at MAX_NODES_PER_INJECTION to avoid PTY buffer issues
    const nodeIdsToInject: readonly string[] = nodeIds.slice(0, MAX_NODES_PER_INJECTION)

    const { payload, injectedCount } = buildNodeInjectionPayload(nodeIdsToInject, graph, deps.getNodeTitle)

    if (injectedCount === 0) {
        return { success: true, injectedCount: 0 }
    }

    try {
        // Send batched payload as single write to avoid PTY flooding
        await deps.sendTextToTerminal(terminalId, payload)

        // Mark injected nodes as seen by updating context node's containedNodeIds
        await deps.updateContextNodeContainedIds(contextNodeId, nodeIdsToInject)

        return { success: true, injectedCount }
    } catch (error: unknown) {
        deps.logError(`[inject-nodes-into-terminal] Failed for terminal ${terminalId}:`, error)
        return { success: false, injectedCount: 0 }
    }
}
