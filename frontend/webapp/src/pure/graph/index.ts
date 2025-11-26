import * as O from 'fp-ts/lib/Option.js'
import * as RTE from 'fp-ts/lib/ReaderTaskEither.js'
import { applyGraphDeltaToGraph } from './graphDelta/applyGraphDeltaToGraph'
import { mapNewGraphToDelta } from './graphDelta/mapNewGraphtoDelta'
import { stripDeltaForReplay } from './graphDelta/stripDeltaForReplay'
import { setOutgoingEdges } from './graph-operations /graph-edge-operations'
import { reverseGraphEdges } from './graph-operations /graph-transformations'
import { prettyPrintGraphDelta } from './graph-operations /prettyPrint'
import { graphToAscii } from './markdown-writing/graphToAscii'
import { getSubgraphByDistance } from './graph-operations /traversal/getSubgraphByDistance'
import { getNodeIdsInTraversalOrder } from './graph-operations /traversal/getNodeIdsInTraversalOrder'
import { mapFSEventsToGraphDelta } from './mapFSEventsToGraphDelta'


// CONTAINS TYPES AND FUNCTION TYPES

export interface Graph {
    readonly nodes: Record<NodeIdAndFilePath, GraphNode>
}


export interface Edge {
    readonly targetId: NodeIdAndFilePath
    readonly label: string  // empty string if no relationship label
}

/**
 * GraphNode represents a node in the app layer.
 *
 * SOURCE OF TRUTH ARCHITECTURE:
 * - Markdown layer (filesystem, floating editors): Markdown is the source of truth.
 *   Full content with YAML frontmatter and [[wikilinks]] for all properties.
 * - App layer (GraphNode): Content has NO frontmatter or links.
 *   Edges and nodeUIMetadata hold the source of truth instead.
 *
 * When converting between layers:
 * - Markdown -> GraphNode: Strip frontmatter/links ([[]] -> []*) from content, populate edges + metadata
 * - GraphNode -> Markdown: Rebuild frontmatter from metadata, append and add back ([]* -> [[]]) wikilinks from edges
 */
export interface GraphNode {
    // CORE GRAPH STRUCTURE
    readonly outgoingEdges: readonly Edge[] // Adjacency list to children / outgoing outgoingEdges
    // incomingEdges is derived
    readonly relativeFilePathIsID: NodeIdAndFilePath //  we enforce relativeFilePathIsID = relativeFilePath

    // DATA - content WITHOUT frontmatter or wikilinks (those are in edges + metadata)
    readonly contentWithoutYamlOrLinks: string

    // METADATA - holds frontmatter properties for this node, and any app-specific node metadata
    readonly nodeUIMetadata: NodeUIMetadata

    // FS DB METADATA
    // readonly fileName:  (filePath: FilePath) => string, derived
}

export interface NodeUIMetadata {
    readonly title: string // Computed from frontmatter title, first heading, or filename
    readonly color: O.Option<string>
    readonly position: O.Option<Position>
    readonly additionalYAMLProps: ReadonlyMap<string,string> // todo support this at both read and write paths for Node <-> Markdown
    readonly isContextNode?: boolean // undefined means false
    // width/height is derived from node degree
}

// Example object used to derive YAML keys at runtime (types are erased, but object keys remain)
const _exampleNodeUIMetadata: NodeUIMetadata = {
    title: 'Example Node',
    color: O.some('purple'),
    position: O.some({ x: 100, y: 200 }),
    additionalYAMLProps: new Map([['agent_name', 'Wendy']]),
    isContextNode: false
}

// Keys that have explicit fields in NodeUIMetadata (excludes additionalYAMLProps which holds the rest)
export const NODE_UI_METADATA_YAML_KEYS: Set<string> = new Set(
    Object.keys(_exampleNodeUIMetadata).filter(k => k !== 'additionalYAMLProps')
)

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
    readonly eventType: 'Added' | 'Changed'
}

export interface FSDelete {
    readonly type: 'Delete'
    readonly absolutePath: FilePath
}

export type FSWriteEffect<A> = RTE.ReaderTaskEither<Env, Error, A>

// ============================================================================
// CORE FUNCTION EXPORTS
// ============================================================================

// markdown -> Node //strips yaml, and replaces [[(\w+)]] with [$1]* + outgoing edge

// node -> markdown // adds back yaml and links for any outgoing edges



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

// === CORE GRAPH DELTA OPERATIONS ===

export { applyGraphDeltaToGraph } from './graphDelta/applyGraphDeltaToGraph'
void (applyGraphDeltaToGraph satisfies ApplyGraphDeltaToGraph)

export { mapNewGraphToDelta } from './graphDelta/mapNewGraphtoDelta'
void (mapNewGraphToDelta satisfies MapNewGraphToDelta)

export { stripDeltaForReplay } from './graphDelta/stripDeltaForReplay'
void (stripDeltaForReplay satisfies StripDeltaForReplay)

export { mapFSEventsToGraphDelta } from './mapFSEventsToGraphDelta'
void (mapFSEventsToGraphDelta satisfies MapFSEventsToGraphDelta)

export { setOutgoingEdges } from './graph-operations /graph-edge-operations'
void (setOutgoingEdges satisfies SetOutgoingEdges)

export { reverseGraphEdges } from './graph-operations /graph-transformations'
void (reverseGraphEdges satisfies ReverseGraphEdges)

export { getSubgraphByDistance } from './graph-operations /traversal/getSubgraphByDistance'
void (getSubgraphByDistance satisfies GetSubgraphByDistance)

export { graphToAscii } from './markdown-writing/graphToAscii'
void (graphToAscii satisfies GraphToAscii)

export { getNodeIdsInTraversalOrder } from './graph-operations /traversal/getNodeIdsInTraversalOrder'
void (getNodeIdsInTraversalOrder satisfies GetNodeIdsInTraversalOrder)

export { prettyPrintGraphDelta } from './graph-operations /prettyPrint'
void (prettyPrintGraphDelta satisfies PrettyPrintGraphDelta)
