/**
 * Inject selected node content into an agent terminal PTY and mark them as seen.
 *
 * Renderer calls: window.electronAPI.main.injectNodesIntoTerminal(id, nodeIds)
 * Zero-boilerplate RPC: just add to mainAPI, types flow via Promisify.
 */

import type { NodeIdAndFilePath, Graph, GraphNode } from '@/pure/graph'
import { getGraph } from '@/shell/edge/main/state/graph-store'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'
import { sendTextToTerminal } from './send-text-to-terminal'
import { getTerminalRecords, type TerminalRecord } from './terminal-registry'
import { updateContextNodeContainedIds } from '@/shell/edge/main/graph/context-nodes/updateContextNodeContainedIds'

const MAX_NODES_PER_INJECTION: number = 5
const MAX_NODE_CONTENT_LENGTH: number = 2000

/**
 * Inject node content into a terminal and mark the nodes as seen in the context node.
 *
 * 1. For each nodeId, read node content from graph
 * 2. Format as injection payload (XML-tagged blocks)
 * 3. Batch into single sendTextToTerminal call to avoid PTY flooding
 * 4. Update context node's containedNodeIds to include injected nodeIds (mark seen)
 * 5. Return success response
 */
export async function injectNodesIntoTerminal(
    terminalId: string,
    nodeIds: readonly string[]
): Promise<{ success: boolean; injectedCount: number }> {
    const records: TerminalRecord[] = getTerminalRecords()
    const record: TerminalRecord | undefined = records.find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )

    if (!record) {
        return { success: false, injectedCount: 0 }
    }

    const contextNodeId: NodeIdAndFilePath = record.terminalData.attachedToContextNodeId
    const graph: Graph = getGraph()

    // Cap at MAX_NODES_PER_INJECTION to avoid PTY buffer issues
    const nodeIdsToInject: readonly string[] = nodeIds.slice(0, MAX_NODES_PER_INJECTION)

    // Build injection payload
    const nodeBlocks: string[] = []
    for (const nodeId of nodeIdsToInject) {
        const graphNode: GraphNode | undefined = graph.nodes[nodeId]
        if (!graphNode) continue

        const title: string = getNodeTitle(graphNode)
        let content: string = graphNode.contentWithoutYamlOrLinks
        if (content.length > MAX_NODE_CONTENT_LENGTH) {
            content = content.slice(0, MAX_NODE_CONTENT_LENGTH) + '\n... (truncated)'
        }

        nodeBlocks.push(`<injected-node path="${nodeId}">\n# ${title}\n${content}\n</injected-node>`)
    }

    if (nodeBlocks.length === 0) {
        return { success: true, injectedCount: 0 }
    }

    const payload: string = `\nHere are nodes manually injected by the user:\n\n${nodeBlocks.join('\n\n')}\n`

    try {
        // Send batched payload as single write to avoid PTY flooding
        await sendTextToTerminal(terminalId, payload)

        // Mark injected nodes as seen by updating context node's containedNodeIds
        await updateContextNodeContainedIds(contextNodeId, nodeIdsToInject)

        return { success: true, injectedCount: nodeBlocks.length }
    } catch (error: unknown) {
        console.error(`[inject-nodes-into-terminal] Failed for terminal ${terminalId}:`, error)
        return { success: false, injectedCount: 0 }
    }
}
