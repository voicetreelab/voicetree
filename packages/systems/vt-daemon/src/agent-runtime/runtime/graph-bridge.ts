import type { FilePath, Graph, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph'
import * as O from 'fp-ts/lib/Option.js'
import type { UnseenNode } from '@vt/graph-db-protocol'
import { getGraphBridge, type GraphStateBridge, type WatchStatus } from './runtime-config'

function requireGraphBridge(): GraphStateBridge {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    if (!bridge) {
        throw new Error('Agent runtime graph bridge not configured. Call configureAgentRuntime({ graph: ... }) at boot.')
    }
    return bridge
}

export async function getRuntimeGraph(): Promise<Graph> {
    return await requireGraphBridge().getGraph()
}

export async function getRuntimeWriteFolder(): Promise<O.Option<FilePath>> {
    return await requireGraphBridge().getWriteFolder()
}

export async function getRuntimeProjectRoot(): Promise<FilePath | null> {
    return await requireGraphBridge().getProjectRoot()
}

export async function getRuntimeVaultPaths(): Promise<readonly FilePath[]> {
    return await requireGraphBridge().getVaultPaths()
}

export async function applyRuntimeGraphDelta(
    delta: GraphDelta,
    recordForUndo: boolean = true,
): Promise<void> {
    await requireGraphBridge().applyGraphDelta(delta, recordForUndo)
}

export async function getRuntimeWatchStatus(): Promise<WatchStatus> {
    return await requireGraphBridge().getWatchStatus()
}

export async function runtimeCreateContextNode(
    parentNodeId: NodeIdAndFilePath,
    semanticNodeIds: readonly NodeIdAndFilePath[] = [],
): Promise<NodeIdAndFilePath> {
    return await requireGraphBridge().createContextNode(parentNodeId, semanticNodeIds)
}

export async function runtimeCreateContextNodeFromSelectedNodes(
    taskNodeId: NodeIdAndFilePath,
    selectedNodeIds: readonly NodeIdAndFilePath[],
): Promise<NodeIdAndFilePath> {
    return await requireGraphBridge().createContextNodeFromSelectedNodes(taskNodeId, selectedNodeIds)
}

export async function getRuntimeUnseenNodesAroundContextNode(
    contextNodeId: NodeIdAndFilePath,
    searchFromNode?: NodeIdAndFilePath,
): Promise<readonly UnseenNode[]> {
    return await requireGraphBridge().getUnseenNodesAroundContextNode(contextNodeId, searchFromNode)
}

export async function runtimeUpdateContextNodeContainedIds(
    contextNodeId: NodeIdAndFilePath,
    newNodeIds: readonly string[],
): Promise<void> {
    await requireGraphBridge().updateContextNodeContainedIds(contextNodeId, newNodeIds)
}
