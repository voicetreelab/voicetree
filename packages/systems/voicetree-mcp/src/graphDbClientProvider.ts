import type {GraphDbClient} from '@vt/graph-db-client'
import {createGraph} from '@vt/graph-model/graph'
import type {Graph, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'

let configuredClient: GraphDbClient | undefined

export function configureGraphDbClient(client: GraphDbClient): void {
    configuredClient = client
}

export function getConfiguredGraphDbClient(): GraphDbClient {
    if (!configuredClient) {
        throw new Error('GraphDbClient is not configured for voicetree-mcp')
    }
    return configuredClient
}

export async function getConfiguredGraph(): Promise<Graph> {
    const graphState = await getConfiguredGraphDbClient().getGraph()
    return createGraph(graphState.nodes as Record<NodeIdAndFilePath, GraphNode>)
}
