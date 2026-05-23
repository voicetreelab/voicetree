// Late-bound bridges into Electron-only state that the MCP tool surface still
// reaches through. Both Electron and vt-mcpd register their own implementations
// at boot — those concrete dependencies arrive through this config object,
// keeping this package free of Electron and renderer-side imports.

import type { Command, Delta, SerializedState } from '@vt/graph-state'
import type { Graph, GraphDelta, NodeIdAndFilePath } from '@vt/graph-model/graph'
import type { UnseenNode } from '@vt/graph-db-protocol'

export type LiveStateBridge = {
    readonly applyLiveCommand: (cmd: Command) => Promise<Delta>
    readonly getLiveStateSnapshot: () => Promise<SerializedState | null>
}

export type SearchSimilarResult = {
    readonly node_path: string
    readonly score: number
    readonly title: string
}

export type AskQueryResponse = {
    readonly relevant_nodes: readonly SearchSimilarResult[]
}

export type SearchBridge = {
    readonly askQuery: (query: string, topK?: number) => Promise<AskQueryResponse>
}

export type GraphBridge = {
    readonly getGraph: () => Promise<Graph>
    readonly getVaultPaths: () => Promise<readonly string[]>
    readonly getWritePath: () => Promise<string | null>
    readonly getProjectRootWatchedDirectory?: () => Promise<string | null>
    readonly getUnseenNodesAroundContextNode?: (
        contextNodeId: NodeIdAndFilePath,
        searchFromNode?: NodeIdAndFilePath,
    ) => Promise<readonly UnseenNode[]>
    readonly applyGraphDelta: (delta: GraphDelta, recordForUndo?: boolean) => Promise<void>
}

export type McpServerConfig = {
    readonly graph?: GraphBridge
    readonly liveState?: LiveStateBridge
    readonly search?: SearchBridge
}

let config: McpServerConfig = {}

export function configureMcpServer(c: McpServerConfig): void {
    config = c
}

export function getLiveStateBridge(): LiveStateBridge {
    if (!config.liveState) {
        throw new Error(
            'MCP live-state bridge not configured. Call configureMcpServer({ liveState: ... }) at boot.'
        )
    }
    return config.liveState
}

export function getSearchBridge(): SearchBridge | undefined {
    return config.search
}

export function getGraphBridge(): GraphBridge | undefined {
    return config.graph
}
