// Pure builder that adapts a `GraphDbClient` (vt-graphd RPC client) into the
// `GraphBridge` shape consumed by the in-process RPC tool surface
// (`getToolGraph`, `getToolProjectPaths`, `getToolWriteFolderPath`,
// `getToolProjectRoot`, `getToolUnseenNodesAroundContextNode`,
// `applyToolGraphDelta`). Lives here rather than inside `bin/vtd.ts` so the
// daemon entrypoint stays a thin composition of pure helpers and so the same
// wire-up can be tested independently of binary launch.
//
// Why the rehydration step exists: the daemon serializes `Graph` over JSON,
// which collapses the Graph-level Map indexes (`nodeByBaseName`,
// `incomingEdgesIndex`, `unresolvedLinksIndex`) into plain objects. Tools
// that consume the bridge — `getNewNodesForAgentIdentities`,
// `mapNodeIdToNode`, the createGraphTool's parent-resolution path — rely on
// those Map types. Rehydrating by replaying a delta onto an empty graph
// rebuilds those indexes through `applyGraphDeltaToGraph`'s normal write
// path, so the daemon-side `Graph` is shape-equivalent to one produced
// in-process.

import type {GraphDbClient} from '@vt/graph-db-client'
import {
    applyGraphDeltaToGraph,
    createEmptyGraph,
    mapNewGraphToDelta,
    type Graph,
    type GraphNode,
    type NodeIdAndFilePath,
} from '@vt/graph-model/graph'
import type {GraphBridge} from './toolBridges.ts'

export function normalizeDaemonGraph(raw: {nodes: Record<string, unknown>}): Graph {
    const normalizedNodes: Record<NodeIdAndFilePath, GraphNode> =
        raw.nodes as Record<NodeIdAndFilePath, GraphNode>
    const emptyGraph: Graph = createEmptyGraph()
    return applyGraphDeltaToGraph(
        emptyGraph,
        mapNewGraphToDelta({...emptyGraph, nodes: normalizedNodes}),
    )
}

export function buildGdbGraphBridge(client: GraphDbClient, projectRoot: string): GraphBridge {
    return {
        getGraph: async (): Promise<Graph> => normalizeDaemonGraph(await client.getGraph()),
        getProjectPaths: async (): Promise<readonly string[]> => {
            const vs = await client.getProject()
            const seen: Set<string> = new Set<string>()
            const out: string[] = []
            for (const p of [vs.writeFolderPath, ...vs.readPaths]) {
                if (p && !seen.has(p)) {
                    seen.add(p)
                    out.push(p)
                }
            }
            return out
        },
        getWriteFolderPath: async (): Promise<string | null> =>
            (await client.getProject()).writeFolderPath ?? null,
        getProjectRoot: async (): Promise<string | null> => projectRoot,
        getUnseenNodesAroundContextNode: (contextNodeId, searchFromNode) =>
            client.getUnseenNodesAroundContextNode(contextNodeId, searchFromNode),
        applyGraphDelta: async (delta, recordForUndo): Promise<void> => {
            await client.applyGraphDelta(delta as unknown as unknown[], {
                recordForUndo: recordForUndo ?? true,
            })
        },
    }
}
