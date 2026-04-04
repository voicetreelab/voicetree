// Re-export shim — actual implementation in @vt/graph-model
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
} from '@vt/graph-model'
