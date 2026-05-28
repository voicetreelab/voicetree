import * as O from 'fp-ts/lib/Option.js'
import * as RTE from 'fp-ts/lib/ReaderTaskEither.js'
import { applyGraphDeltaToGraph } from './graphDelta/applyGraphDeltaToGraph'
import { mapNewGraphToDelta } from './graphDelta/mapNewGraphtoDelta'
import { stripDeltaForReplay } from './graphDelta/stripDeltaForReplay'
import { setOutgoingEdges } from './graph-operations/transforms/graph-edge-operations'
import { reverseGraphEdges, makeBidirectionalEdges } from './graph-operations/transforms/graph-transformations'
import { prettyPrintGraphDelta } from './graph-operations/transforms/prettyPrint'
import { graphToAscii } from './markdown-writing/graphToAscii'
import { getSubgraphByDistance, getUnionSubgraphByDistance } from './graph-operations/traversal/getSubgraphByDistance'
import { getNodeIdsInTraversalOrder } from './graph-operations/traversal/getNodeIdsInTraversalOrder'
import { mapFSEventsToGraphDelta } from './construction/mapFSEventsToGraphDelta'


// CONTAINS TYPES AND FUNCTION TYPES

export interface Graph {
    readonly nodes: Record<NodeIdAndFilePath, GraphNode>
    readonly incomingEdgesIndex: ReadonlyMap<NodeIdAndFilePath, readonly NodeIdAndFilePath[]>
    readonly nodeByBaseName: ReadonlyMap<string, readonly NodeIdAndFilePath[]>
    readonly unresolvedLinksIndex: ReadonlyMap<string, readonly NodeIdAndFilePath[]>
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
    readonly kind: 'leaf' | 'folder'
    readonly outgoingEdges: readonly Edge[] // Adjacency list to children / outgoing outgoingEdges
    // incomingEdges is derived
    readonly absoluteFilePathIsID: NodeIdAndFilePath //  we enforce relativeFilePathIsID = relativeFilePath to watched folder

    // DATA - content WITHOUT frontmatter or wikilinks (those are in edges + metadata)
    readonly contentWithoutYamlOrLinks: string

    // METADATA - holds frontmatter properties for this node, and any app-specific node metadata
    readonly nodeUIMetadata: NodeUIMetadata

    // FS DB METADATA
    // readonly fileName:  (filePath: FilePath) => string, derived
}

export interface NodeUIMetadata {
    // NOTE: title is NOT stored here - it's derived via getNodeTitle(node) from Markdown content
    readonly color: O.Option<string>
    readonly position: O.Option<Position>
    readonly additionalYAMLProps: Record<string, string>
    readonly isContextNode?: boolean // undefined means false
    readonly containedNodeIds?: readonly NodeIdAndFilePath[] // Node IDs whose content is contained in this context node
    // width/height is derived from node degree
}

// Example object used to derive YAML keys at runtime (types are erased, but object keys remain)
const _exampleNodeUIMetadata: NodeUIMetadata = {
    color: O.some('purple'),
    position: O.some({ x: 100, y: 200 }),
    additionalYAMLProps: { agent_name: 'Wendy' },
    isContextNode: false
}

// Keys that have explicit fields in NodeUIMetadata (excludes additionalYAMLProps which holds the rest)
// Also includes 'title' which is NOT stored in NodeUIMetadata but should be excluded from additionalYAMLProps
// since title is derived from markdown content (single source of truth)
export const NODE_UI_METADATA_YAML_KEYS: ReadonlySet<string> = new Set([
    ...Object.keys(_exampleNodeUIMetadata).filter(k => k !== 'additionalYAMLProps'),
    'title' // Legacy YAML title is ignored - title comes from markdown content via getNodeTitle()
])

// ============================================================================
// GRAPH DELTAS
// ============================================================================

export type GraphDelta = readonly NodeDelta[];

export type NodeDelta = UpsertNodeDelta | DeleteNode

export interface UpsertNodeDelta {
    readonly type: 'UpsertNode'
    readonly nodeToUpsert: GraphNode
    readonly previousNode: O.Option<GraphNode>  // None = new node, Some = update
}

export interface DeleteNode {
    readonly type: 'DeleteNode'
    readonly nodeId: NodeIdAndFilePath
    readonly deletedNode: O.Option<GraphNode>   // For undo - full node that was deleted
}


// ============================================================================
// FS
// ============================================================================


export interface Env {
    readonly projectRoot: string
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

export type MapFSEventsToGraphDelta = (fsEvent: FSEvent, currentGraph: Graph) => GraphDelta

// === CORE GRAPH OPERATIONS ===

export type SetOutgoingEdges = (node: GraphNode, edges: readonly Edge[]) => GraphNode

export type ReverseGraphEdges = (graph: Graph) => Graph

export type MakeBidirectionalEdges = (graph: Graph) => Graph

export type GetSubgraphByDistance = (graph: Graph, startNodeId: NodeIdAndFilePath, maxDistance: number) => Graph

export type GetUnionSubgraphByDistance = (graph: Graph, startNodeIds: readonly NodeIdAndFilePath[], maxDistance: number) => Graph

export type GraphToAscii = (graph: Graph, forcedRootNodeId?: NodeIdAndFilePath) => string

export type GetNodeIdsInTraversalOrder = (graph: Graph) => readonly NodeIdAndFilePath[]

export type PrettyPrintGraphDelta = (delta: GraphDelta) => string

// === CORE GRAPH DELTA OPERATIONS ===

export { applyGraphDeltaToGraph, rebaseStaleEdgeAdditionDeltas } from './graphDelta/applyGraphDeltaToGraph'
void (applyGraphDeltaToGraph satisfies ApplyGraphDeltaToGraph)

export { mapNewGraphToDelta } from './graphDelta/mapNewGraphtoDelta'
void (mapNewGraphToDelta satisfies MapNewGraphToDelta)

export { stripDeltaForReplay } from './graphDelta/stripDeltaForReplay'
void (stripDeltaForReplay satisfies StripDeltaForReplay)

export { mapFSEventsToGraphDelta } from './construction/mapFSEventsToGraphDelta'
void (mapFSEventsToGraphDelta satisfies MapFSEventsToGraphDelta)

export { setOutgoingEdges } from './graph-operations/transforms/graph-edge-operations'
void (setOutgoingEdges satisfies SetOutgoingEdges)

export { reverseGraphEdges } from './graph-operations/transforms/graph-transformations'
void (reverseGraphEdges satisfies ReverseGraphEdges)

export { makeBidirectionalEdges } from './graph-operations/transforms/graph-transformations'
void (makeBidirectionalEdges satisfies MakeBidirectionalEdges)

export { getSubgraphByDistance } from './graph-operations/traversal/getSubgraphByDistance'
void (getSubgraphByDistance satisfies GetSubgraphByDistance)

export { getUnionSubgraphByDistance } from './graph-operations/traversal/getSubgraphByDistance'
void (getUnionSubgraphByDistance satisfies GetUnionSubgraphByDistance)

export { graphToAscii } from './markdown-writing/graphToAscii'
void (graphToAscii satisfies GraphToAscii)

export { getNodeIdsInTraversalOrder } from './graph-operations/traversal/getNodeIdsInTraversalOrder'
void (getNodeIdsInTraversalOrder satisfies GetNodeIdsInTraversalOrder)

export { prettyPrintGraphDelta } from './graph-operations/transforms/prettyPrint'
void (prettyPrintGraphDelta satisfies PrettyPrintGraphDelta)

// === GRAPH TRANSFORMATION UTILITIES ===
export { deleteNodeSimple } from './graph-operations/transforms/removeNodeMaintainingTransitiveEdges'
export { removeContextNodes } from './graph-operations/transforms/removeContextNodes'

// === GRAPH CREATION UTILITIES ===
export { createGraph, createEmptyGraph } from './construction/createGraph'

// === GRAPH BUILDING FROM FILES ===
export type BuildGraphFromFiles = (files: readonly { readonly absolutePath: string; readonly content: string }[]) => Graph

export { buildGraphFromFiles } from './construction/buildGraphFromFiles'
import { buildGraphFromFiles } from './construction/buildGraphFromFiles'
void (buildGraphFromFiles satisfies BuildGraphFromFiles)

// === FOLDER NOTE RESOLUTION ===
export { getFolderNotePath } from './folder-note/getFolderNotePath'

// === FOLDER COLLAPSE PURE LAYER (BF-116) ===
export type { OriginalEdgeRef, SyntheticEdgeSpec, ExpandPlan } from './nodes/folderCollapse'
export { computeSyntheticEdgeSpecs, computeExpandPlan, findCollapsedAncestor, absolutePathToGraphFolderId } from './nodes/folderCollapse'

// === NODE TYPE DETECTION ===
export { isImageNode, IMAGE_EXTENSIONS } from './nodes/isImageNode'

// === AGENT NODE QUERIES ===
export { getNodesByAgentName } from './nodes/getNodesByAgentName'

// === POSITIONING ===
export type MergePositionsIntoGraph = (graph: Graph, positions: ReadonlyMap<NodeIdAndFilePath, Position>) => Graph

export { mergePositionsIntoGraph } from './positioning/layout/mergePositionsIntoGraph'
import { mergePositionsIntoGraph } from './positioning/layout/mergePositionsIntoGraph'
void (mergePositionsIntoGraph satisfies MergePositionsIntoGraph)
