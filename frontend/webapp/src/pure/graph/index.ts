import * as O from 'fp-ts/lib/Option.js'
import * as RTE from 'fp-ts/lib/ReaderTaskEither.js'
import { applyGraphDeltaToGraph as applyGraphDeltaToGraphImpl } from './graphDelta/applyGraphDeltaToGraph.ts'
import { mapNewGraphToDelta as mapNewGraphToDeltaImpl } from './graphDelta/mapNewGraphtoDelta.ts'
import { stripDeltaForReplay as stripDeltaForReplayImpl } from './graphDelta/stripDeltaForReplay.ts'
import { setOutgoingEdges as setOutgoingEdgesImpl } from './graph-operations /graph-edge-operations.ts'
import { reverseGraphEdges as reverseGraphEdgesImpl } from './graph-operations /graph-transformations.ts'
import { prettyPrintGraphDelta as prettyPrintGraphDeltaImpl } from './graph-operations /prettyPrint.ts'
import { mapFSEventsToGraphDelta as mapFSEventsToGraphDeltaImpl } from './mapFSEventsToGraphDelta.ts'


// CONTAINS TYPES AND FUNCTION TYPES

export interface Graph {
    readonly nodes: Record<NodeId, GraphNode>
}


export interface Edge {
    readonly targetId: NodeId
    readonly label: string  // empty string if no relationship label
}

export interface GraphNode {
    // CORE GRAPH STRUCTURE
    readonly outgoingEdges: readonly Edge[] // Adjacency list to children / outgoing outgoingEdges
    // incomingEdges is derived
    readonly relativeFilePathIsID: NodeId //  we enforce relativeFilePathIsID = relativeFilePath

    // DATA
    readonly content: string

    // visual METADATA
    readonly nodeUIMetadata: NodeUIMetadata

    // FS DB METADATA
    // readonly fileName:  (filePath: FilePath) => string, derived
}

export interface NodeUIMetadata {
    readonly title: string // Computed from frontmatter title, first heading, or filename
    readonly color: O.Option<string>
    readonly position: O.Option<Position>
    // width/height is derived from node degree
}

// ============================================================================
// GRAPH DELTAS
// ============================================================================

export type GraphDelta = readonly NodeDelta[];

export type NodeDelta = UpsertNodeAction | DeleteNode

export interface UpsertNodeAction {
    readonly type: 'UpsertNode'
    readonly nodeToUpsert: GraphNode
}

export interface DeleteNode {
    readonly type: 'DeleteNode'
    readonly nodeId: NodeId
}


// ============================================================================
// FS
// ============================================================================


export interface Env {
    readonly vaultPath: string
}
export type FilePath = string // todo enforce only / and chars

export type NodeId = FilePath

export interface Position {
    readonly x: number // from top left of canvas origin?
    readonly y: number
}

export type FSEvent = FSUpdate | FSDelete

export interface FSUpdate {
    readonly absolutePath: FilePath
    readonly content: string
    readonly eventType: 'Added' | 'Changed' | 'Deleted'
}

export interface FSDelete {readonly absolutePath: FilePath}

export type FSWriteEffect<A> = RTE.ReaderTaskEither<Env, Error, A>

// ============================================================================
// CORE FUNCTION EXPORTS
// ============================================================================

// === CORE GRAPH DELTA OPERATIONS ===

export type ApplyGraphDeltaToGraph = (graph: Graph, delta: GraphDelta) => Graph

export type MapNewGraphToDelta = (graph: Graph) => GraphDelta

export type StripDeltaForReplay = (delta: GraphDelta) => GraphDelta

export type MapFSEventsToGraphDelta = (fsEvent: FSEvent, vaultPath: string, currentGraph: Graph) => GraphDelta

// === CORE GRAPH OPERATIONS ===

export type SetOutgoingEdges = (node: GraphNode, edges: readonly Edge[]) => GraphNode

export type ReverseGraphEdges = (graph: Graph) => Graph

export type PrettyPrintGraphDelta = (delta: GraphDelta) => string

export const mapNewGraphToDelta: MapNewGraphToDelta = mapNewGraphToDeltaImpl
export const stripDeltaForReplay: StripDeltaForReplay = stripDeltaForReplayImpl
export const mapFSEventsToGraphDelta: MapFSEventsToGraphDelta = mapFSEventsToGraphDeltaImpl
export const setOutgoingEdges: SetOutgoingEdges = setOutgoingEdgesImpl
export const reverseGraphEdges: ReverseGraphEdges = reverseGraphEdgesImpl
export const applyGraphDeltaToGraph: ApplyGraphDeltaToGraph = applyGraphDeltaToGraphImpl
export const prettyPrintGraphDelta: PrettyPrintGraphDelta = prettyPrintGraphDeltaImpl
// === CORE DB OPERATIONS ===
// Note: DB operations (applyGraphActionsToDB) are NOT exported here
// They contain Node.js fs imports and should only be used in main process
// Import directly from './graphActionsToDBEffects.ts' in main process code
