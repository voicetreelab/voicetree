// Re-export shim — actual implementation in @vt/graph-db-server
export {
    loadGraphFromDisk,
    loadVaultPathAdditively,
    scanMarkdownFiles,
    isReadPath,
    extractLinkTargets,
    resolveLinkTarget,
    resolveLinkedNodesInWatchedFolder,
} from '@vt/graph-db-server/graph/loadGraphFromDisk'
