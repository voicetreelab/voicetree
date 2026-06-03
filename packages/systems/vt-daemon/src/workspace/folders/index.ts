// `@vt/app-config/folders` — filesystem folder operations shared by the Electron
// main process and VTD (browser-mode gateway): directory scanning, the sidebar
// folder-tree payload, the "add folder" selector, folder mutations, and starred
// folders. All deep functions, FS impurity pushed to this edge module.

export {
    getDirectoryTree,
    getSubfoldersWithModifiedAt,
    isValidSubdirectory,
} from './folder-scanning.ts'

export {
    buildFolderTreeSyncPayload,
    selectAvailableFolders,
    isPathWithinAllowlist,
    type FolderTreeProjectState,
    type FolderTreeSyncPayload,
} from './folder-tree-payload.ts'

export {
    createSubfolder,
    copyNodeToFolder,
    type FolderMutationResult,
    type CopyNodeResult,
} from './folder-ops.ts'

export {
    getStarredFolders,
    addStarredFolder,
    removeStarredFolder,
    isStarred,
} from './starred-folders.ts'
