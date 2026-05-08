import type { FilePath, Graph, GraphNode } from '@vt/graph-model/graph'
import type { GraphDbClient } from '@vt/graph-db-client'
import { getProjectRootWatchedDirectory } from '@/shell/edge/main/state/watch-folder-store'
import { ensureDaemonClientForVault, type CachedDaemonConnection } from './graph-daemon'
import { getNormalizedDaemonGraph } from './daemon-graph-normalization'

const TIMEOUT_MS: number = 10_000

async function getClient(): Promise<GraphDbClient> {
    const vault: FilePath | null = getProjectRootWatchedDirectory()
    if (!vault) throw new Error('No vault is currently open')
    const connection: CachedDaemonConnection = await ensureDaemonClientForVault(vault, { timeoutMs: TIMEOUT_MS })
    return connection.client
}

export async function findFileByNameThroughDaemon(name: string): Promise<string[]> {
    const client: GraphDbClient = await getClient()
    return await client.findFileByName(name)
}

export async function getPreviewContainedNodeIdsThroughDaemon(
    nodeId: string,
): Promise<readonly string[]> {
    const client: GraphDbClient = await getClient()
    return await client.getPreviewContainedNodeIds(nodeId)
}

export async function getNodeThroughDaemon(
    nodeId: string,
): Promise<GraphNode | undefined> {
    const client: GraphDbClient = await getClient()
    const graph: Graph = await getNormalizedDaemonGraph(client)
    return graph.nodes[nodeId]
}

export async function performUndoThroughDaemon(): Promise<boolean> {
    const client: GraphDbClient = await getClient()
    return await client.undo()
}

export async function performRedoThroughDaemon(): Promise<boolean> {
    const client: GraphDbClient = await getClient()
    return await client.redo()
}
