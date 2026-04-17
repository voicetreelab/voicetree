/**
 * Isolation stub — mirrors the subset of `@vt/graph-model/pure/graph` that
 * contract.d.ts imports. Used ONLY by `tsc -p tsconfig.isolated.json` so the
 * contract can be type-checked without traversing the (currently error-
 * ridden) graph-model source tree.
 *
 * Not used at runtime. Not shipped. BF-142 may delete once graph-model tsc
 * passes clean on main.
 */
import type { Option } from 'fp-ts/lib/Option.js'

export type NodeIdAndFilePath = string
export interface Position { readonly x: number; readonly y: number }
export interface Edge { readonly targetId: NodeIdAndFilePath; readonly label: string }
export interface NodeUIMetadata {
    readonly color: Option<string>
    readonly position: Option<Position>
    readonly additionalYAMLProps: ReadonlyMap<string, string>
    readonly isContextNode?: boolean
    readonly containedNodeIds?: readonly NodeIdAndFilePath[]
}
export interface GraphNode {
    readonly outgoingEdges: readonly Edge[]
    readonly absoluteFilePathIsID: NodeIdAndFilePath
    readonly contentWithoutYamlOrLinks: string
    readonly nodeUIMetadata: NodeUIMetadata
}
export interface Graph {
    readonly nodes: Record<NodeIdAndFilePath, GraphNode>
    readonly incomingEdgesIndex: ReadonlyMap<NodeIdAndFilePath, readonly NodeIdAndFilePath[]>
    readonly nodeByBaseName: ReadonlyMap<string, readonly NodeIdAndFilePath[]>
    readonly unresolvedLinksIndex: ReadonlyMap<string, readonly NodeIdAndFilePath[]>
}
