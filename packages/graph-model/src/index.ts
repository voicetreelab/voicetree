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
export { loadSettings, saveSettings, clearSettingsCache, migrateLayoutConfigIfNeeded, migrateStarredFoldersIfNeeded, migrateStarredFoldersBrainRename } from './settings/settings_IO'

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
