// Re-export shim — actual implementation in @vt/graph-db-server
export {
    isValidSubdirectory,
    getSubfoldersWithModifiedAt,
    getDirectoryTree,
} from '@vt/graph-db-server/watch-folder/folder-scanner'
export { getAvailableFoldersForSelector } from '@vt/graph-db-server/watch-folder/watchFolder'
