import type { FolderVisibilityDatabase } from '../sqlite/folderVisibilitySqlite'
import {
    closeFolderVisibilityDb,
    openFolderVisibilityDb,
} from '../sqlite/folderVisibilitySqlite'
import {
    ensureDefaultView,
    getActiveViewId,
} from '../sqlite/viewsRepository'
import type { FilePath } from '../pure/graph'

type FolderState = 'expanded' | 'collapsed' | 'hidden'
type FolderVisibilityState = ReadonlyMap<string, FolderState>

type FolderVisibilityStoreApi = {
    configureFolderVisibilityStore(db: FolderVisibilityDatabase): void
    clearFolderVisibilityStoreForTests(): void
    getFolderVisibility(viewId: string): FolderVisibilityState
    setFolderState(viewId: string, path: string, state: FolderState): void
}

const graphStatePackageName = '@vt/graph-state'

async function loadFolderVisibilityStore(): Promise<FolderVisibilityStoreApi> {
    return await import(graphStatePackageName) as FolderVisibilityStoreApi
}

export async function getExpandedFolderPathsForVault(vaultPath: FilePath): Promise<readonly FilePath[]> {
    const store = await loadFolderVisibilityStore()
    const db: FolderVisibilityDatabase = openFolderVisibilityDb(vaultPath)
    try {
        ensureDefaultView(db)
        store.configureFolderVisibilityStore(db)
        const activeViewId: string = getActiveViewId(db)
        return [...store.getFolderVisibility(activeViewId)]
            .filter(([, state]) => state === 'expanded')
            .map(([folderPath]) => folderPath)
    } finally {
        store.clearFolderVisibilityStoreForTests()
        closeFolderVisibilityDb(db)
    }
}

export async function setActiveViewFolderState(
    vaultPath: FilePath,
    folderPath: FilePath,
    state: FolderState,
): Promise<void> {
    const store = await loadFolderVisibilityStore()
    const db: FolderVisibilityDatabase = openFolderVisibilityDb(vaultPath)
    try {
        ensureDefaultView(db)
        store.configureFolderVisibilityStore(db)
        store.setFolderState(getActiveViewId(db), folderPath, state)
    } finally {
        store.clearFolderVisibilityStoreForTests()
        closeFolderVisibilityDb(db)
    }
}
