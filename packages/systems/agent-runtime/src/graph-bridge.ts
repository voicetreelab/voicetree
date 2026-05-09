import type { FilePath, Graph, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph'
import * as O from 'fp-ts/lib/Option.js'
import {
    getUnseenNodesAroundContextNode as getDefaultUnseenNodesAroundContextNode,
    type UnseenNode,
} from '@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode'
import { createContextNode as createDefaultContextNode } from '@vt/graph-db-server/context-nodes/createContextNode'
import { createContextNodeFromSelectedNodes as createDefaultContextNodeFromSelectedNodes } from '@vt/graph-db-server/context-nodes/createContextNodeFromSelectedNodes'
import { updateContextNodeContainedIds as updateDefaultContextNodeContainedIds } from '@vt/graph-db-server/context-nodes/updateContextNodeContainedIds'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors as applyDefaultGraphDelta,
    refreshGraphChangeSideEffects as refreshDefaultGraphChangeSideEffects,
} from '@vt/graph-db-server/graph/applyGraphDelta'
import { getGraph as getDefaultGraph, setGraph as setDefaultGraph } from '@vt/graph-db-server/state/graph-store'
import { getProjectRootWatchedDirectory as getDefaultProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import { getWatchStatus as getDefaultWatchStatus } from '@vt/graph-db-server/watch-folder/watchFolder'
import {
    getVaultPaths as getDefaultVaultPaths,
    getWritePath as getDefaultWritePath,
} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import { getGraphBridge, type GraphStateBridge, type WatchStatus } from './runtime-config'

export function getRuntimeGraph(): Graph {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    return bridge ? bridge.getGraph() : getDefaultGraph()
}

export function setRuntimeGraph(graph: Graph): void {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    if (bridge) {
        bridge.setGraph(graph)
        return
    }

    setDefaultGraph(graph)
}

export async function getRuntimeWritePath(): Promise<O.Option<FilePath>> {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    return bridge ? await bridge.getWritePath() : await getDefaultWritePath()
}

export async function getRuntimeVaultPaths(): Promise<readonly FilePath[]> {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    return bridge ? await bridge.getVaultPaths() : await getDefaultVaultPaths()
}

export async function applyRuntimeGraphDelta(
    delta: GraphDelta,
    recordForUndo: boolean = true,
): Promise<void> {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    if (bridge) {
        await bridge.applyGraphDelta(delta, recordForUndo)
        return
    }

    await applyDefaultGraphDelta(delta, recordForUndo)
}

export function getRuntimeProjectRoot(): FilePath | null {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    return bridge ? bridge.getProjectRootWatchedDirectory() : getDefaultProjectRootWatchedDirectory()
}

export function getRuntimeWatchStatus(): WatchStatus {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    return bridge ? bridge.getWatchStatus() : getDefaultWatchStatus()
}

export function runtimeRefreshGraphSideEffects(): void {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    if (bridge) {
        bridge.refreshGraphChangeSideEffects()
        return
    }

    refreshDefaultGraphChangeSideEffects()
}

export async function runtimeCreateContextNode(
    parentNodeId: NodeIdAndFilePath,
    semanticNodeIds: readonly NodeIdAndFilePath[] = [],
): Promise<NodeIdAndFilePath> {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    return bridge
        ? await bridge.createContextNode(parentNodeId, semanticNodeIds)
        : await createDefaultContextNode(parentNodeId, semanticNodeIds)
}

export async function runtimeCreateContextNodeFromSelectedNodes(
    taskNodeId: NodeIdAndFilePath,
    selectedNodeIds: readonly NodeIdAndFilePath[],
): Promise<NodeIdAndFilePath> {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    return bridge
        ? await bridge.createContextNodeFromSelectedNodes(taskNodeId, selectedNodeIds)
        : await createDefaultContextNodeFromSelectedNodes(taskNodeId, selectedNodeIds)
}

export async function getRuntimeUnseenNodesAroundContextNode(
    contextNodeId: NodeIdAndFilePath,
    searchFromNode?: NodeIdAndFilePath,
): Promise<readonly UnseenNode[]> {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    return bridge
        ? await bridge.getUnseenNodesAroundContextNode(contextNodeId, searchFromNode)
        : await getDefaultUnseenNodesAroundContextNode(contextNodeId, searchFromNode)
}

export async function runtimeUpdateContextNodeContainedIds(
    contextNodeId: NodeIdAndFilePath,
    newNodeIds: readonly string[],
): Promise<void> {
    const bridge: GraphStateBridge | undefined = getGraphBridge()
    if (bridge) {
        await bridge.updateContextNodeContainedIds(contextNodeId, newNodeIds)
        return
    }

    await updateDefaultContextNodeContainedIds(contextNodeId, newNodeIds)
}
