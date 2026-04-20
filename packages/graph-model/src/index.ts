/**
 * @vt/graph-model public API
 *
 * Dependency-injected graph model package.
 * No Electron imports — all platform-specific behaviour supplied via callbacks.
 *
 * Usage:
 *   import { initGraphModel, loadFolder, startFileWatching } from '@vt/graph-model'
 *   initGraphModel({ appSupportPath: app.getPath('userData') }, callbacks)
 */

// Pure graph types and operations (re-exported from pure/)
export type { Graph, GraphNode, GraphDelta, NodeDelta, UpsertNodeDelta, DeleteNode, Edge, NodeUIMetadata, NodeIdAndFilePath, FilePath, Position, FSEvent, FSUpdate, FSDelete, Env } from './pure/graph'
export { CONTEXT_NODES_FOLDER, NODE_UI_METADATA_YAML_KEYS, applyGraphDeltaToGraph, mapNewGraphToDelta, stripDeltaForReplay, mapFSEventsToGraphDelta, setOutgoingEdges, reverseGraphEdges, makeBidirectionalEdges, getSubgraphByDistance, getUnionSubgraphByDistance, graphToAscii, getNodeIdsInTraversalOrder, prettyPrintGraphDelta, deleteNodeSimple, removeContextNodes, createGraph, createEmptyGraph, buildGraphFromFiles, getFolderNotePath, isImageNode, IMAGE_EXTENSIONS, getNodesByAgentName } from './pure/graph'
export { getNodeTitle, parseMarkdownToGraphNode } from './pure/graph/markdown-parsing'
export { calculateInitialPositionForChild } from './pure/graph/positioning/calculateInitialPosition'
export { ensureUniqueNodeId } from './pure/graph/ensureUniqueNodeId'
export { fromCreateChildToUpsertNode } from './pure/graph/graphDelta/uiInteractionsToGraphDeltas'
export { nodeIdToFilePathWithExtension } from './pure/graph/markdown-parsing/filename-utils'
export { fromNodeToMarkdownContent } from './pure/graph/markdown-writing/node_to_markdown'
export { linkMatchScore } from './pure/graph/markdown-parsing/extract-edges'
export { applyPositions, rebaseNewClusterPositions } from './pure/graph/positioning'
export { addNodeToGraphWithEdgeHealingFromFSEvent } from './pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
export { stripBracketedContent } from './pure/graph/contentChangeDetection'

// Pure settings types
export type { VTSettings } from './pure/settings/types'

// Pure folder types
export type { FolderTreeNode, AbsolutePath, AvailableFolderItem } from './pure/folders/types'
export { toAbsolutePath } from './pure/folders/types'
export { buildFolderTree, getExternalReadPaths, getAvailableFolders, parseSearchQuery } from './pure/folders/transforms'
export type { DirectoryEntry, ParsedQuery } from './pure/folders/transforms'

// Pure project types
export type { SavedProject, DiscoveredProject } from './pure/project/types'
export type { NodeSearchHit, SearchBackend } from './search/types'
export { SearchIndexNotFoundError } from './search/types'
export { buildIndex, search, upsertNode, deleteNode } from './search/index-backend'

// DI initialization
export { initGraphModel, getConfig, getCallbacks } from './types'
export type { GraphModelConfig, GraphModelCallbacks } from './types'

// Watch-folder / vault management
export {
    initialLoad,
    loadFolder,
    startFileWatching,
    stopFileWatching,
    getWatchStatus,
    loadPreviousFolder,
    markFrontendReady,
    isWatching,
    // vault-allowlist re-exports
    getVaultPaths,
    getReadPaths,
    getWritePath,
    setWritePath,
    addReadPath,
    removeReadPath,
    getVaultPath,
    setVaultPath,
    clearVaultPath,
    createDatedVoiceTreeFolder,
    createSubfolder,
    // folder-scanner re-export
    getAvailableFoldersForSelector,
} from './watch-folder/watchFolder'

export { broadcastVaultState } from './watch-folder/broadcast-vault-state'
export { broadcastFolderTree, broadcastFolderTreeImmediate } from './watch-folder/broadcast-folder-tree'
export { getStarredFolders, addStarredFolder, removeStarredFolder, isStarred, copyNodeToFolder } from './watch-folder/starred-folders'
export { isValidSubdirectory, getSubfoldersWithModifiedAt, getDirectoryTree } from './watch-folder/folder-scanner'

// Watch-folder internals (exposed for shim compatibility)
export {
    resolveWritePath, type ResolvedVaultConfig, resolveAllowlistForProject,
    type LoadVaultPathOptions, type LoadVaultPathResult, loadAndMergeVaultPath,
} from './watch-folder/vault-allowlist'
export {
    type VoiceTreeConfig, getConfigPath, loadConfig, saveConfig,
    getLastDirectory, saveLastDirectory, getVaultConfigForDirectory, saveVaultConfigForDirectory,
} from './watch-folder/voicetree-config-io'
export { createStarterNode } from './watch-folder/create-starter-node'
export { readFileWithRetry, setupWatcher, setupWatcherListeners } from './watch-folder/file-watcher-setup'

// Graph state
export { getGraph, setGraph, getNode } from './state/graph-store'
export {
    getWatcher,
    setWatcher,
    getProjectRootWatchedDirectory,
    setProjectRootWatchedDirectory,
    onReadPathsChanged,
    emitReadPathsChanged,
    getStartupFolderOverride,
    setStartupFolderOverride,
    getOnFolderSwitchCleanup,
    setOnFolderSwitchCleanup,
    clearWatchFolderState,
} from './state/watch-folder-store'
export {
    getUndoState, resetUndoState, recordUserActionAndSetDeltaHistoryState,
    popUndoDelta, popRedoDelta, canUndo, canRedo,
} from './state/undo-store'
export {
    markRecentDelta, isOurRecentDelta, clearRecentDeltas,
    getRecentDeltasCount, getRecentDeltasForNodeId,
} from './state/recent-deltas-store'

// Graph operations
export {
    applyGraphDeltaToDBThroughMemAndUIAndEditors,
    applyGraphDeltaToMemState,
    broadcastGraphDeltaToUI,
    applyGraphDeltaToDBThroughMemAndUI,
} from './graph/applyGraphDelta'
export { loadPositions, mergePositionsIntoGraph, savePositionsSync } from './graph/positions-store'
export { handleFSEventWithStateAndUISides } from './graph/handleFSEvent'
export { findFileByName } from './graph/findFileByName'
export { apply_graph_deltas_to_db } from './graph/graphActionsToDBEffects'
export { performUndo, performRedo } from './graph/undoOperations'
export { writeAllPositionsSync } from './graph/writeAllPositionsOnExit'
export {
    loadGraphFromDisk, loadVaultPathAdditively, scanMarkdownFiles,
    isReadPath, extractLinkTargets, resolveLinkTarget, resolveLinkedNodesInWatchedFolder,
} from './graph/loadGraphFromDisk'
export { type FileLimitExceededError, enforceFileLimit } from './graph/fileLimitEnforce'
export { notifyTextToTreeServerOfDirectory } from './graph/notifyTextToTreeServer'

// Context nodes
export { createContextNode } from './context-nodes/createContextNode'
export { createContextNodeFromQuestion } from './context-nodes/createContextNodeFromQuestion'
export { createContextNodeFromSelectedNodes } from './context-nodes/createContextNodeFromSelectedNodes'
export { getUnseenNodesAroundContextNode, type UnseenNode } from './context-nodes/getUnseenNodesAroundContextNode'
export { getPreviewContainedNodeIds } from './context-nodes/getPreviewContainedNodeIds'
export { updateContextNodeContainedIds } from './context-nodes/updateContextNodeContainedIds'

// Settings
export { loadSettings, saveSettings, clearSettingsCache, migrateAgentPromptCoreOnAppUpdateIfNeeded, migrateLayoutConfigIfNeeded, migrateStarredFoldersIfNeeded, migrateStarredFoldersBrainRename } from './settings/settings_IO'

// Project management
export { loadProjects, saveProject, removeProject } from './project/project-store'
export { scanForProjects, getDefaultSearchDirectories } from './project/project-scanner'
export { initializeProject } from './project/project-initializer'
export {
    generateDateSubfolder,
    createDatedSubfolder,
    findExistingVoicetreeDir,
    pathExists,
    copyMarkdownFiles,
} from './project/project-utils'
