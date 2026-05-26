import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph'
import type { UnseenNode } from '@vt/graph-db-protocol'
import { getGraphBridge, type GraphBridge } from './mcp-config'

type McpGraphSnapshot = Awaited<ReturnType<NonNullable<GraphBridge['getSnapshot']>>>

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

export async function getMcpGraphSnapshot(): Promise<McpGraphSnapshot> {
    const bridge: GraphBridge = requireGraphBridge('getMcpGraphSnapshot')
    if (bridge.getSnapshot) {
        return await bridge.getSnapshot()
    }
    const [graph, writeFolder, vaultPaths, projectRoot] = await Promise.all([
        bridge.getGraph(),
        bridge.getWriteFolder(),
        bridge.getVaultPaths(),
        bridge.getProjectRoot ? bridge.getProjectRoot() : Promise.resolve(null),
    ])
    return {graph, projectRoot, vaultPaths, writeFolder}
}

export async function getMcpWriteFolder(): Promise<O.Option<string>> {
    return O.fromNullable(await requireGraphBridge('getMcpWriteFolder').getWriteFolder())
}

export async function getMcpVaultPaths(): Promise<readonly string[]> {
    return await requireGraphBridge('getMcpVaultPaths').getVaultPaths()
}

export async function getMcpProjectRoot(): Promise<string | null> {
    const bridge: GraphBridge = requireGraphBridge('getMcpProjectRoot')
    return bridge.getProjectRoot ? await bridge.getProjectRoot() : null
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
