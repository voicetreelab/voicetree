// Pure helpers over a GraphBridge instance. Tools take the bridge (or a
// deps object that carries it) explicitly — no module-level cell — so the
// dependency is visible in the type signature and every test constructs
// its own bridge directly.

import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {UnseenNode} from '@vt/graph-db-protocol'
import type {GraphBridge} from './mcpBridges.ts'

export type {UnseenNode}

export async function getMcpGraph(bridge: GraphBridge): Promise<Graph> {
    return await bridge.getGraph()
}

export async function getMcpWriteFolder(bridge: GraphBridge): Promise<O.Option<string>> {
    return O.fromNullable(await bridge.getWriteFolder())
}

export async function getMcpVaultPaths(bridge: GraphBridge): Promise<readonly string[]> {
    return await bridge.getVaultPaths()
}

export async function getMcpProjectRoot(bridge: GraphBridge): Promise<string | null> {
    return bridge.getProjectRoot ? await bridge.getProjectRoot() : null
}

export async function getMcpUnseenNodesAroundContextNode(
    bridge: GraphBridge,
    contextNodeId: NodeIdAndFilePath,
    searchFromNode?: NodeIdAndFilePath,
): Promise<readonly UnseenNode[]> {
    if (!bridge.getUnseenNodesAroundContextNode) {
        throw new Error(
            'GraphBridge does not implement getUnseenNodesAroundContextNode.',
        )
    }
    return await bridge.getUnseenNodesAroundContextNode(contextNodeId, searchFromNode)
}

export async function applyMcpGraphDelta(
    bridge: GraphBridge,
    delta: GraphDelta,
    recordForUndo: boolean = true,
): Promise<void> {
    await bridge.applyGraphDelta(delta, recordForUndo)
}
