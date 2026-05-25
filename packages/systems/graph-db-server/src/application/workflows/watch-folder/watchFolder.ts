/**
 * Watch folder public workflow API.
 *
 * The implementation is split by concern:
 * - watchFolderLoad owns opening/loading and legacy watcher verbs.
 * - watchFolderProject owns the consolidated project verbs.
 */

export {
    getWatchStatus,
    initialLoad,
    isWatching,
    loadFolder,
    loadPreviousFolder,
    markFrontendReady,
    startFileWatching,
    stopFileWatching,
} from "./watchFolderLoad";
export type { WatchFolderLoadOptions } from "./watchFolderLoad";

export {
    closeProject,
    getProjectStatus,
    openProject,
    setFolderState,
    setWriteFolder,
} from "./watchFolderProject";
export type { ProjectStatus } from "./watchFolderProject";
