// Re-export shim — actual implementation in @vt/graph-model
export {
    loadGraphFromDisk,
    loadVaultPathAdditively,
    scanMarkdownFiles,
    isReadPath,
    extractLinkTargets,
    resolveLinkTarget,
    resolveLinkedNodesInWatchedFolder,
} from '@vt/graph-model'
