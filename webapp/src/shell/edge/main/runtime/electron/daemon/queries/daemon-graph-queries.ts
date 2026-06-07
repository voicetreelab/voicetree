import * as O from 'fp-ts/lib/Option.js'
import { getCallbacks } from '@vt/graph-model'
import type { Graph, GraphNode, NodeIdAndFilePath, Position, Size } from '@vt/graph-model/graph'
import { callDaemon } from '@/shell/edge/main/runtime/electron/daemon/lifecycle/graph-daemon'
import { getNormalizedDaemonGraph } from './daemon-graph-normalization'
import { loadSettings } from '@/shell/edge/main/settings/settings_IO'
import type { VTSettings } from '@vt/graph-model/settings'
import path from 'path'

// One persisted spatial-layout record on the wire: any of position (x,y)
// and/or size (w,h). Mirrors the daemon's write-node-layout schema.
type NodeLayoutRecord = { x?: number; y?: number; w?: number; h?: number }
type NodeLayoutRecordMap = Record<string, NodeLayoutRecord>

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

    const callbacks: ReturnType<typeof getCallbacks> = getCallbacks()
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
    return await callDaemon((client) => client.findFileByName(name))
}

export async function getPreviewContainedNodeIdsThroughDaemon(
    nodeId: string,
): Promise<readonly string[]> {
    return await callDaemon((client) => client.getPreviewContainedNodeIds(nodeId))
}

export async function getGraphThroughDaemon(): Promise<Graph> {
    return await callDaemon((client) => getNormalizedDaemonGraph(client))
}

export async function createContextNodeThroughDaemon(
    parentNodeId: NodeIdAndFilePath,
): Promise<NodeIdAndFilePath> {
    return await callDaemon(async (client) => {
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
    })
}

export async function createContextNodeFromQuestionThroughDaemon(
    nodeIds: readonly NodeIdAndFilePath[],
    question: string,
): Promise<{ nodeId: NodeIdAndFilePath; parentNodePath: NodeIdAndFilePath | ''; title: string }> {
    return await callDaemon(async (client) => {
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
    })
}

export async function performUndoThroughDaemon(): Promise<boolean> {
    return await callDaemon((client) => client.undo())
}

export async function performRedoThroughDaemon(): Promise<boolean> {
    return await callDaemon((client) => client.redo())
}

export async function writeNodeLayoutThroughDaemon(
    layout: NodeLayoutRecordMap,
): Promise<{ written: number }> {
    return await callDaemon((client) => client.writeNodeLayout(layout))
}

/**
 * Persist a single folder's size (folder resize) through the unified
 * write-node-layout channel, keyed by the folder's directory id (FolderId).
 */
export async function writeNodeSizeThroughDaemon(
    folderId: NodeIdAndFilePath,
    size: Size,
): Promise<{ written: number }> {
    return await writeNodeLayoutThroughDaemon({
        [folderId]: { w: size.width, h: size.height },
    })
}

export async function writeCurrentNodeLayoutThroughDaemon(): Promise<{ written: number }> {
    return await callDaemon(async (client) => {
        const graph: Graph = await getNormalizedDaemonGraph(client)
        return await client.writeNodeLayout(collectNodeLayoutFromGraph(graph))
    })
}

function collectNodeLayoutFromGraph(graph: Graph): NodeLayoutRecordMap {
    const layout: NodeLayoutRecordMap = {}
    for (const [nodeId, node] of Object.entries(graph.nodes)) {
        const position: O.Option<Position> = node.nodeUIMetadata.position
        const size: O.Option<Size> = node.nodeUIMetadata.size ?? O.none
        if (O.isSome(position) || O.isSome(size)) {
            layout[nodeId] = {
                ...(O.isSome(position) ? { x: position.value.x, y: position.value.y } : {}),
                ...(O.isSome(size) ? { w: size.value.width, h: size.value.height } : {}),
            }
        }
    }
    return layout
}
