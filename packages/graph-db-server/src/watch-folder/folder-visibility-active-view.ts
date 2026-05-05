import type { FolderVisibilityDatabase } from '../views/folderVisibilitySqlite'
import type { FilePath } from '@vt/graph-model/pure/graph'

type FolderState = 'expanded' | 'collapsed' | 'hidden'
type FolderVisibilityState = ReadonlyMap<string, FolderState>

type FolderVisibilityStoreApi = {
    configureFolderVisibilityStore(db: FolderVisibilityDatabase): void
    clearFolderVisibilityStoreForTests(): void
    getFolderVisibility(viewId: string): FolderVisibilityState
    setFolderState(viewId: string, path: string, state: FolderState): void
}

type FolderVisibilityStoreAndDerivation = FolderVisibilityStoreApi & {
    deriveWatchRoots(map: FolderVisibilityState): Set<string>
}

async function loadFolderVisibilityDbModule(): Promise<typeof import('../views/folderVisibilitySqlite')> {
    return await import('../views/folderVisibilitySqlite')
}

async function loadViewsRepository(): Promise<typeof import('../views/viewsRepository')> {
    return await import('../views/viewsRepository')
}

async function loadFolderVisibilityStore(): Promise<FolderVisibilityStoreApi> {
    return (await import('@vt/graph-state')) as unknown as FolderVisibilityStoreApi
}

async function loadStoreWithDerivation(): Promise<FolderVisibilityStoreAndDerivation> {
    return (await import('@vt/graph-state')) as unknown as FolderVisibilityStoreAndDerivation
}

export async function getExpandedFolderPathsForVault(vaultPath: FilePath): Promise<readonly FilePath[]> {
    const store = await loadFolderVisibilityStore()
    const { closeFolderVisibilityDb, openFolderVisibilityDb } = await loadFolderVisibilityDbModule()
    const { ensureDefaultView, getActiveViewId } = await loadViewsRepository()
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

/**
 * Get the topmost expanded folder paths for the active view (watch roots).
 * Uses deriveWatchRoots so nested expanded folders don't add redundant mounts.
 */
export async function getWatchRootsForActiveView(vaultPath: FilePath): Promise<readonly string[]> {
    const store = await loadStoreWithDerivation()
    const { closeFolderVisibilityDb, openFolderVisibilityDb } = await loadFolderVisibilityDbModule()
    const { ensureDefaultView, getActiveViewId } = await loadViewsRepository()
    const db: FolderVisibilityDatabase = openFolderVisibilityDb(vaultPath)
    try {
        ensureDefaultView(db)
        store.configureFolderVisibilityStore(db)
        const activeViewId: string = getActiveViewId(db)
        const map = store.getFolderVisibility(activeViewId)
        return [...store.deriveWatchRoots(map)]
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
    const { closeFolderVisibilityDb, openFolderVisibilityDb } = await loadFolderVisibilityDbModule()
    const { ensureDefaultView, getActiveViewId } = await loadViewsRepository()
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
