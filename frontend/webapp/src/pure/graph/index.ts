import * as O from 'fp-ts/lib/Option.js'
import * as RTE from 'fp-ts/lib/ReaderTaskEither.js'
import { applyGraphDeltaToGraph } from './graphDelta/applyGraphDeltaToGraph.ts'
import { mapNewGraphToDelta } from './graphDelta/mapNewGraphtoDelta.ts'
import { stripDeltaForReplay } from './graphDelta/stripDeltaForReplay.ts'
import { setOutgoingEdges } from './graph-operations /graph-edge-operations.ts'
import { reverseGraphEdges } from './graph-operations /graph-transformations.ts'
import { prettyPrintGraphDelta } from './graph-operations /prettyPrint.ts'
import { graphToAscii } from './markdown-writing/graphToAscii.ts'
import { getSubgraphByDistance } from './graph-operations /traversal/getSubgraphByDistance.ts'
import { getNodeIdsInTraversalOrder } from './graph-operations /traversal/getNodeIdsInTraversalOrder.ts'
import { mapFSEventsToGraphDelta } from './mapFSEventsToGraphDelta.ts'


// CONTAINS TYPES AND FUNCTION TYPES

export interface Graph {
    readonly nodes: Record<NodeIdAndFilePath, GraphNode>
}


export interface Edge {
    readonly targetId: NodeIdAndFilePath
    readonly label: string  // empty string if no relationship label
}

export interface GraphNode {
    // CORE GRAPH STRUCTURE
    readonly outgoingEdges: readonly Edge[] // Adjacency list to children / outgoing outgoingEdges
    // incomingEdges is derived
    readonly relativeFilePathIsID: NodeIdAndFilePath //  we enforce relativeFilePathIsID = relativeFilePath

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
    readonly nodeId: NodeIdAndFilePath
}


// ============================================================================
// FS
// ============================================================================


export interface Env {
    readonly vaultPath: string
}
export type FilePath = string // todo enforce only / and chars

export type NodeIdAndFilePath = FilePath

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

export type GetSubgraphByDistance = (graph: Graph, startNodeId: NodeIdAndFilePath, maxDistance: number) => Graph

export type GraphToAscii = (graph: Graph) => string

export type GetNodeIdsInTraversalOrder = (graph: Graph) => readonly NodeIdAndFilePath[]

export type PrettyPrintGraphDelta = (delta: GraphDelta) => string

// ============================================================================
// FUNCTION IMPLEMENTATIONS
// ============================================================================

// === CORE GRAPH DELTA OPERATIONS ===

export { applyGraphDeltaToGraph } from './graphDelta/applyGraphDeltaToGraph.ts'
void (applyGraphDeltaToGraph satisfies ApplyGraphDeltaToGraph)

export { mapNewGraphToDelta } from './graphDelta/mapNewGraphtoDelta.ts'
void (mapNewGraphToDelta satisfies MapNewGraphToDelta)

export { stripDeltaForReplay } from './graphDelta/stripDeltaForReplay.ts'
void (stripDeltaForReplay satisfies StripDeltaForReplay)

export { mapFSEventsToGraphDelta } from './mapFSEventsToGraphDelta.ts'
void (mapFSEventsToGraphDelta satisfies MapFSEventsToGraphDelta)

// === CORE GRAPH OPERATIONS ===

export { setOutgoingEdges } from './graph-operations /graph-edge-operations.ts'
void (setOutgoingEdges satisfies SetOutgoingEdges)

export { reverseGraphEdges } from './graph-operations /graph-transformations.ts'
void (reverseGraphEdges satisfies ReverseGraphEdges)

export { getSubgraphByDistance } from './graph-operations /traversal/getSubgraphByDistance.ts'
void (getSubgraphByDistance satisfies GetSubgraphByDistance)

export { graphToAscii } from './markdown-writing/graphToAscii.ts'
void (graphToAscii satisfies GraphToAscii)

export { getNodeIdsInTraversalOrder } from './graph-operations /traversal/getNodeIdsInTraversalOrder.ts'
void (getNodeIdsInTraversalOrder satisfies GetNodeIdsInTraversalOrder)

export { prettyPrintGraphDelta } from './graph-operations /prettyPrint.ts'
void (prettyPrintGraphDelta satisfies PrettyPrintGraphDelta)

// === CORE DB OPERATIONS ===
// Note: DB operations (applyGraphActionsToDB) are NOT exported here
// They contain Node.js fs imports and should only be used in main process
// Import directly from './graphActionsToDBEffects.ts' in main process code
