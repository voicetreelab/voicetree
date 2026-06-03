// Re-export shim — actual implementation in @vt/app-config/folders, shared with
// VTD's browser-mode folder gateway so the recursive FS scan lives in one place.
export {
    getDirectoryTree,
    getSubfoldersWithModifiedAt,
    isValidSubdirectory,
} from '@vt/app-config/folders'
