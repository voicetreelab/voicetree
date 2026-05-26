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
    readonly getWriteFolder: () => Promise<string | null>
    readonly getProjectRoot?: () => Promise<string | null>
    readonly getSnapshot?: () => Promise<{
        readonly graph: Graph
        readonly projectRoot: string | null
        readonly vaultPaths: readonly string[]
        readonly writeFolder: string | null
    }>
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

type McpServerConfigCell = {
    readonly configure: (next: McpServerConfig) => void
    readonly get: () => McpServerConfig
}

function createMcpServerConfigCell(initial: McpServerConfig): McpServerConfigCell {
    let current: McpServerConfig = initial
    return {
        configure: (next: McpServerConfig): void => {
            current = next
        },
        get: (): McpServerConfig => current,
    }
}

const configCell: McpServerConfigCell = createMcpServerConfigCell({})

export function configureMcpServer(c: McpServerConfig): void {
    configCell.configure(c)
}

export function getLiveStateBridge(): LiveStateBridge {
    const config: McpServerConfig = configCell.get()
    if (!config.liveState) {
        throw new Error(
            'MCP live-state bridge not configured. Call configureMcpServer({ liveState: ... }) at boot.'
        )
    }
    return config.liveState
}

export function getSearchBridge(): SearchBridge | undefined {
    return configCell.get().search
}

export function getGraphBridge(): GraphBridge | undefined {
    return configCell.get().graph
}
