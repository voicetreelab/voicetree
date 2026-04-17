/**
 * Isolation stub — mirrors the subset of `@vt/graph-model` top-level barrel
 * that contract.d.ts imports (FolderTreeNode + GraphDelta). Used ONLY by
 * `tsc -p tsconfig.isolated.json`. See graph-model-pure-graph.d.ts header.
 */
import type { GraphNode, NodeIdAndFilePath } from './graph-model-pure-graph'

export interface FolderTreeNode {
    readonly path: string
    readonly name: string
    readonly children?: readonly FolderTreeNode[]
}

export interface UpsertNodeDelta {
    readonly type: 'UpsertNode'
    readonly nodeToUpsert: GraphNode
    readonly previousNode: unknown
}
export interface DeleteNode {
    readonly type: 'DeleteNode'
    readonly nodeId: NodeIdAndFilePath
    readonly deletedNode: unknown
}
export type NodeDelta = UpsertNodeDelta | DeleteNode
export type GraphDelta = readonly NodeDelta[]
