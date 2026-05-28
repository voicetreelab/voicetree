/**
 * @vt/graph-model public API
 *
 * PURE package: types, transforms, markdown parsing, graph operations.
 * No I/O, no native deps, no daemon logic.
 * Importable by renderer, CLI, daemon, and tests.
 */

// Pure graph types and operations (re-exported from pure/)
export type { Graph, GraphNode, GraphDelta, NodeDelta, UpsertNodeDelta, DeleteNode, Edge, NodeUIMetadata, NodeIdAndFilePath, FilePath, Position, FSEvent, FSUpdate, FSDelete, Env } from './pure/graph'
export { NODE_UI_METADATA_YAML_KEYS, applyGraphDeltaToGraph, mapNewGraphToDelta, stripDeltaForReplay, mapFSEventsToGraphDelta, setOutgoingEdges, reverseGraphEdges, makeBidirectionalEdges, getSubgraphByDistance, getUnionSubgraphByDistance, graphToAscii, getNodeIdsInTraversalOrder, prettyPrintGraphDelta, deleteNodeSimple, removeContextNodes, createGraph, createEmptyGraph, buildGraphFromFiles, getFolderNotePath, isImageNode, IMAGE_EXTENSIONS, getNodesByAgentName } from './pure/graph'
export { getNodeTitle, parseMarkdownToGraphNode } from './pure/graph/markdown-parsing'
export { calculateInitialPositionForChild } from './pure/graph/positioning/placement/calculateInitialPosition'
export { ensureUniqueNodeId } from './pure/graph/nodes/ensureUniqueNodeId'
export { fromCreateChildToUpsertNode } from './pure/graph/graphDelta/uiInteractionsToGraphDeltas'
export { nodeIdToFilePathWithExtension } from './pure/graph/markdown-parsing/filename-utils'
export { fromNodeToMarkdownContent } from './pure/graph/markdown-writing/node_to_markdown'
export { linkMatchScore } from './pure/graph/markdown-parsing/extract-edges'
export { applyPositions, rebaseNewClusterPositions } from './pure/graph/positioning'
export { addNodeToGraphWithEdgeHealingFromFSEvent } from './pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
export { stripBracketedContent, normalizeContentForEchoComparison } from './pure/graph/nodes/contentChangeDetection'

// Pure settings types
export type { VTSettings } from './pure/settings/types'

// Pure folder types
export type { FolderTreeNode, AbsolutePath, AvailableFolderItem } from './pure/folders/types'
export { toAbsolutePath } from './pure/folders/types'
export { buildFolderTree, getExternalReadPaths, getAvailableFolders, parseSearchQuery } from './pure/folders/transforms'
export type { DirectoryEntry, ParsedQuery } from './pure/folders/transforms'

// Pure project types
export type { SavedProject, DiscoveredProject } from './pure/project/types'

// DI initialization (callbacks only; appSupportPath now lives in per-process state modules)
export { initGraphModel, getCallbacks } from './pure/runtime/types'
export type { GraphModelCallbacks } from './pure/runtime/types'
