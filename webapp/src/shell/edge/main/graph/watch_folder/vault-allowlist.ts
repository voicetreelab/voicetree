// Re-export shim — actual implementation in @vt/graph-model
export {
    resolveWritePath,
    type ResolvedVaultConfig,
    resolveAllowlistForProject,
    type LoadVaultPathOptions,
    type LoadVaultPathResult,
    getVaultPaths,
    getReadPaths,
    getWritePath,
    loadAndMergeVaultPath,
    getVaultPath,
    setVaultPath,
    createDatedVoiceTreeFolder,
    clearVaultPath,
    createSubfolder,
} from '@vt/graph-model'
