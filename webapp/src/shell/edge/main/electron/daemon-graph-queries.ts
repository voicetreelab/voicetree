import * as O from 'fp-ts/lib/Option.js'
import { getCallbacks } from '@vt/graph-model'
import type { FilePath, Graph, GraphNode, NodeIdAndFilePath, Position } from '@vt/graph-model/graph'
import type { GraphDbClient } from '@vt/graph-db-client'
import { getProjectRootWatchedDirectory } from '@/shell/edge/main/state/watch-folder-store'
import { ensureDaemonClientForVault, type CachedDaemonConnection } from './graph-daemon'
import { getNormalizedDaemonGraph } from './daemon-graph-normalization'
import { loadSettings } from '../settings/settings_IO'
import type { VTSettings } from '@vt/graph-model/settings'
import path from 'path'

const TIMEOUT_MS: number = 10_000
type PositionMap = Record<string, Position>

async function getClient(): Promise<GraphDbClient> {
    const vault: FilePath | null = getProjectRootWatchedDirectory()
    if (!vault) throw new Error('No vault is currently open')
    const connection: CachedDaemonConnection = await ensureDaemonClientForVault(vault, { timeoutMs: TIMEOUT_MS })
    return connection.client
}

function resolveGraphNode(
    graph: Graph,
    requestedNodeId: NodeIdAndFilePath,
): GraphNode | undefined {
    const exactNode: GraphNode | undefined = graph.nodes[requestedNodeId]
    if (exactNode) return exactNode

    const basenameMatches: readonly NodeIdAndFilePath[] = Object.keys(graph.nodes)
        .filter((nodeId: string): boolean => path.basename(nodeId) === requestedNodeId) as readonly NodeIdAndFilePath[]

    return basenameMatches.length === 1
        ? graph.nodes[basenameMatches[0]]
        : undefined
}

async function getSemanticRelevantNodes(
    query: string,
    topK: number,
): Promise<readonly NodeIdAndFilePath[]> {
    if (topK <= 0 || !query.trim()) return []

    const callbacks = getCallbacks()
    if (!callbacks.semanticSearch) return []

    const controller: AbortController = new AbortController()
    const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), 1000)

    try {
        const nodePaths: readonly string[] = await Promise.race([
            callbacks.semanticSearch(query, topK),
            new Promise<never>((_, reject) => {
                controller.signal.addEventListener('abort', () => {
                    reject(new Error('Timeout'))
                })
            }),
        ])
        clearTimeout(timeoutId)
        return nodePaths as readonly NodeIdAndFilePath[]
    } catch {
        clearTimeout(timeoutId)
        return []
    }
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

export async function getGraphThroughDaemon(): Promise<Graph> {
    const client: GraphDbClient = await getClient()
    return await getNormalizedDaemonGraph(client)
}

export async function createContextNodeThroughDaemon(
    parentNodeId: NodeIdAndFilePath,
): Promise<NodeIdAndFilePath> {
    const client: GraphDbClient = await getClient()
    const settings: VTSettings = await loadSettings()
    const graph: Graph = await getNormalizedDaemonGraph(client)
    const parentNode: GraphNode | undefined = resolveGraphNode(graph, parentNodeId)
    const semanticNodeIds: readonly NodeIdAndFilePath[] = settings.enableSemanticContext && parentNode
        ? await getSemanticRelevantNodes(
            parentNode.contentWithoutYamlOrLinks,
            settings.contextNodeMaxDistance,
        )
        : []
    const result: { nodeId: string } = await client.createContextNode(parentNodeId, [...semanticNodeIds])
    return result.nodeId
}

export async function createContextNodeFromQuestionThroughDaemon(
    nodeIds: readonly NodeIdAndFilePath[],
    question: string,
): Promise<{ nodeId: NodeIdAndFilePath; parentNodePath: NodeIdAndFilePath | ''; title: string }> {
    const client: GraphDbClient = await getClient()
    const settings: VTSettings = await loadSettings()
    const semanticNodeIds: readonly NodeIdAndFilePath[] = settings.enableSemanticContext
        ? await getSemanticRelevantNodes(question, settings.askModeContextDistance)
        : []
    const result: { nodeId: string; parentNodePath: string; title: string } =
        await client.createContextNodeFromQuestion([...nodeIds], question, [...semanticNodeIds])
    return {
        nodeId: result.nodeId,
        parentNodePath: result.parentNodePath,
        title: result.title,
    }
}

export async function performUndoThroughDaemon(): Promise<boolean> {
    const client: GraphDbClient = await getClient()
    return await client.undo()
}

export async function performRedoThroughDaemon(): Promise<boolean> {
    const client: GraphDbClient = await getClient()
    return await client.redo()
}

export async function writePositionsThroughDaemon(
    positions: PositionMap,
): Promise<{ written: number }> {
    const client: GraphDbClient = await getClient()
    return await client.writePositions(positions)
}

export async function writeCurrentPositionsThroughDaemon(): Promise<{ written: number }> {
    const client: GraphDbClient = await getClient()
    const graph: Graph = await getNormalizedDaemonGraph(client)
    return await client.writePositions(collectPositionsFromGraph(graph))
}

function collectPositionsFromGraph(graph: Graph): PositionMap {
    return Object.entries(graph.nodes).reduce(
        (acc: PositionMap, [nodeId, node]: [string, GraphNode]) => {
            const position = node.nodeUIMetadata.position
            return O.isSome(position)
                ? { ...acc, [nodeId]: position.value }
                : acc
        },
        {},
    )
}
