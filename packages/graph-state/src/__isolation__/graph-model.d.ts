/**
 * Isolation stub — mirrors the subset of `@vt/graph-model` that the
 * graph-state package imports during isolated typechecking. Used ONLY by
 * `tsc -p tsconfig.isolated.json`. See graph-model-pure-graph.d.ts header.
 */
import type { Either } from 'fp-ts/lib/Either.js'
import type { Graph, GraphNode, NodeIdAndFilePath, Position } from './graph-model-pure-graph'

export type { Graph, GraphNode, Position } from './graph-model-pure-graph'

export type AbsolutePath = string & { readonly __brand: 'AbsolutePath' }

export interface FileTreeNode {
    readonly name: string
    readonly absolutePath: AbsolutePath
    readonly isInGraph: boolean
}

export interface FolderTreeNode {
    readonly name: string
    readonly absolutePath: AbsolutePath
    readonly children: readonly (FolderTreeNode | FileTreeNode)[]
    readonly loadState: 'loaded' | 'not-loaded'
    readonly isWriteTarget: boolean
}

export interface DirectoryEntry {
    readonly absolutePath: AbsolutePath
    readonly name: string
    readonly isDirectory: boolean
    readonly children?: readonly DirectoryEntry[]
}

export declare function toAbsolutePath(path: string): AbsolutePath
export declare function buildFolderTree(
    entry: DirectoryEntry,
    loadedPaths: ReadonlySet<string>,
    writePath: AbsolutePath | null,
    graphFilePaths: ReadonlySet<string>,
): FolderTreeNode
export declare function getDirectoryTree(rootPath: string, maxDepth?: number): Promise<DirectoryEntry>
export declare function loadGraphFromDisk(vaultPaths: readonly string[]): Promise<Either<unknown, Graph>>
export declare function buildGraphFromFiles(
    files: readonly { readonly absolutePath: string; readonly content: string }[],
): Graph

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
