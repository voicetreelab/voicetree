// Re-export shim — actual implementation in @vt/graph-db-server
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
} from '@vt/graph-db-server/watch-folder/vault-allowlist'
