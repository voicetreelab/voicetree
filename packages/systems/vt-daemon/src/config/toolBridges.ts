// Late-bound bridges into Electron-only state that the RPC tool surface still
// reaches through. Both Electron and the standalone vtd binary construct
// their own concrete implementations at boot and pass them explicitly into
// `buildToolCatalog` / `buildCatalogDispatchMap` — there is no module-level
// cell. The bridge types stay declared here (a pure types module) so this
// package remains free of Electron and renderer-side imports.

import type {Graph, GraphDelta, NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {UnseenNode} from '@vt/graph-db-protocol'

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
    readonly getProjectPaths: () => Promise<readonly string[]>
    readonly getWriteFolderPath: () => Promise<string | null>
    readonly getProjectRoot?: () => Promise<string | null>
    readonly getUnseenNodesAroundContextNode?: (
        contextNodeId: NodeIdAndFilePath,
        searchFromNode?: NodeIdAndFilePath,
    ) => Promise<readonly UnseenNode[]>
    readonly applyGraphDelta: (delta: GraphDelta, recordForUndo?: boolean) => Promise<void>
}

export type ToolBridges = {
    readonly graph: GraphBridge
    readonly search?: SearchBridge
}
