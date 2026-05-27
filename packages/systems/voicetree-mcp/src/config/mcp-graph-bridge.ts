import type { GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph'
import type { UnseenNode } from '@vt/graph-db-protocol'
import { getGraphBridge, type GraphBridge, type McpGraphSnapshot } from './mcp-config'

function requireGraphBridge(operation: string): GraphBridge {
    const bridge: GraphBridge | undefined = getGraphBridge()
    if (!bridge) {
        throw new Error(
            `MCP graph bridge not configured. Call configureMcpServer({ graph: ... }) at boot before ${operation}.`,
        )
    }
    return bridge
}

export async function getMcpGraphSnapshot(): Promise<McpGraphSnapshot> {
    return await requireGraphBridge('getMcpGraphSnapshot').getSnapshot()
}

export async function getMcpUnseenNodesAroundContextNode(
    contextNodeId: NodeIdAndFilePath,
    searchFromNode?: NodeIdAndFilePath,
): Promise<readonly UnseenNode[]> {
    const bridge: GraphBridge = requireGraphBridge('getMcpUnseenNodesAroundContextNode')
    if (!bridge.getUnseenNodesAroundContextNode) {
        throw new Error(
            'MCP graph bridge does not implement getUnseenNodesAroundContextNode.',
        )
    }
    return await bridge.getUnseenNodesAroundContextNode(contextNodeId, searchFromNode)
}

export async function applyMcpGraphDelta(
    delta: GraphDelta,
    recordForUndo: boolean = true,
): Promise<void> {
    await requireGraphBridge('applyMcpGraphDelta').applyGraphDelta(delta, recordForUndo)
}
