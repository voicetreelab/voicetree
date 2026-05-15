import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph'
import type { UnseenNode } from '@vt/graph-db-protocol'
import { getGraphBridge, type GraphBridge } from './mcp-config'

export type {UnseenNode}

function requireGraphBridge(operation: string): GraphBridge {
    const bridge: GraphBridge | undefined = getGraphBridge()
    if (!bridge) {
        throw new Error(
            `MCP graph bridge not configured. Call configureMcpServer({ graph: ... }) at boot before ${operation}.`,
        )
    }
    return bridge
}

export async function getMcpGraph(): Promise<Graph> {
    return await requireGraphBridge('getMcpGraph').getGraph()
}

export async function getMcpWritePath(): Promise<O.Option<string>> {
    return O.fromNullable(await requireGraphBridge('getMcpWritePath').getWritePath())
}

export async function getMcpVaultPaths(): Promise<readonly string[]> {
    return await requireGraphBridge('getMcpVaultPaths').getVaultPaths()
}

export function getMcpProjectRootWatchedDirectory(): string | null {
    const bridge: GraphBridge = requireGraphBridge('getMcpProjectRootWatchedDirectory')
    return bridge.getProjectRootWatchedDirectory ? bridge.getProjectRootWatchedDirectory() : null
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
