export type {
    AbsolutePath,
    LoadedFolderItem,
    AvailableFolderItem,
    FolderSelectorState,
    FolderAction,
} from './types';

export { toAbsolutePath } from './types';

export {
    toDisplayPath,
    getAvailableFolders,
    reduceFolderConfig,
    toFolderSelectorState,
} from './transforms';

export {
    buildFolderTreeSyncProjection,
    externalFoldersOf,
    resolveAvailableFolders,
    type FolderProjectState,
    type FolderTreeSyncProjection,
    type FolderScan,
} from './projections';
