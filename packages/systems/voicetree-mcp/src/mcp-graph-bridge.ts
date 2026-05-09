import * as O from 'fp-ts/lib/Option.js'
import type { Graph, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph'
import { getGraph as getDefaultGraph } from '@vt/graph-db-server/state/graph-store'
import { setGraph as setDefaultGraph } from '@vt/graph-db-server/state/graph-store'
import { getProjectRootWatchedDirectory as getDefaultProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import {
    getVaultPaths as getDefaultVaultPaths,
    getWritePath as getDefaultWritePath,
    setVaultPath as setDefaultVaultPath,
} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors as applyDefaultGraphDelta,
} from '@vt/graph-db-server/graph/applyGraphDelta'
import {
    getUnseenNodesAroundContextNode as getDefaultUnseenNodesAroundContextNode,
    type UnseenNode,
} from '@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode'
import { getGraphBridge, type GraphBridge } from './mcp-config'

export type {UnseenNode}

export function syncMcpGraphDbServerState(
    graph: Graph,
    projectRootWatchedDirectory: string | null,
): void {
    setDefaultGraph(graph)
    if (projectRootWatchedDirectory) {
        setDefaultVaultPath(projectRootWatchedDirectory)
    }
}

export async function getMcpGraph(): Promise<Graph> {
    const bridge: GraphBridge | undefined = getGraphBridge()
    return bridge ? await bridge.getGraph() : getDefaultGraph()
}

export function getMcpGraphSnapshot(): Graph {
    return getDefaultGraph()
}

export async function getMcpWritePath(): Promise<O.Option<string>> {
    const bridge: GraphBridge | undefined = getGraphBridge()
    if (!bridge) {
        return await getDefaultWritePath()
    }

    return O.fromNullable(await bridge.getWritePath())
}

export async function getMcpVaultPaths(): Promise<readonly string[]> {
    const bridge: GraphBridge | undefined = getGraphBridge()
    return bridge ? await bridge.getVaultPaths() : await getDefaultVaultPaths()
}

export function getMcpProjectRootWatchedDirectory(): string | null {
    const bridge: GraphBridge | undefined = getGraphBridge()
    return bridge?.getProjectRootWatchedDirectory
        ? bridge.getProjectRootWatchedDirectory()
        : getDefaultProjectRootWatchedDirectory()
}

export async function getMcpUnseenNodesAroundContextNode(
    contextNodeId: NodeIdAndFilePath,
    searchFromNode?: NodeIdAndFilePath,
): Promise<readonly UnseenNode[]> {
    const bridge: GraphBridge | undefined = getGraphBridge()
    return bridge?.getUnseenNodesAroundContextNode
        ? await bridge.getUnseenNodesAroundContextNode(contextNodeId, searchFromNode)
        : await getDefaultUnseenNodesAroundContextNode(contextNodeId, searchFromNode)
}

export async function applyMcpGraphDelta(
    delta: GraphDelta,
    recordForUndo: boolean = true,
): Promise<void> {
    const bridge: GraphBridge | undefined = getGraphBridge()
    if (bridge) {
        await bridge.applyGraphDelta(delta, recordForUndo)
        return
    }

    await applyDefaultGraphDelta(delta, recordForUndo)
}
