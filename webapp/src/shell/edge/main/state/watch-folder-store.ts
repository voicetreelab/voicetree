// Re-export shim — actual implementation in @vt/graph-model
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
} from '@vt/graph-model'
