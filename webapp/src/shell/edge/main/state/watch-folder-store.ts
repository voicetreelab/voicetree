// Re-export shim — actual implementation in @vt/graph-db-server
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
} from '@vt/graph-db-server/state/watch-folder-store'
