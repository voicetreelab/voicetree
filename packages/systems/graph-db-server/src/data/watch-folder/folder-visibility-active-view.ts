import type { FolderVisibilityDatabase } from '../views/folderVisibilitySqlite'
import type { FilePath } from '@vt/graph-model/graph'
import normalizePath from 'normalize-path'

type FolderState = 'expanded' | 'collapsed' | 'hidden'
/**
 * The folder states that keep (or leave) a folder's nodes loaded in the graph.
 * Writing `'hidden'` is deliberately excluded here: a folder may only reach
 * `'hidden'` through the unload transition (`projectAllowlist.removeReadPath`),
 * which purges the folder's graph nodes in the same step. That single funnel is
 * what enforces INV-1 (`hidden ⟹ no loaded nodes`).
 */
export type LoadedFolderState = Exclude<FolderState, 'hidden'>
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

async function loadFolderVisibilityResource(): Promise<typeof import('../views/folderVisibilityResource')> {
    return await import('../views/folderVisibilityResource')
}

/** Pure: the expanded folder paths from a folder-state listing. */
function expandedFolderPaths(
    folderState: readonly (readonly [path: string, state: string])[],
): readonly FilePath[] {
    return folderState
        .filter(([, state]) => state === 'expanded')
        .map(([folderPath]) => folderPath as FilePath)
}

export async function getExpandedFolderPathsForProject(projectRoot: FilePath): Promise<readonly FilePath[]> {
    let resource: Awaited<ReturnType<typeof loadFolderVisibilityResource>>
    try {
        resource = await loadFolderVisibilityResource()
    } catch {
        // node:sqlite (and the resource's sqlite-backed deps) are unavailable in
        // this runtime — safe to return empty because the daemon manages folder
        // visibility in that mode.
        return []
    }
    // Hot path: once the project's long-lived folder-visibility db handle is
    // open (everything after `openResources`), reuse it. The read runs a live
    // SELECT against the same on-disk db, so this returns data identical to a
    // fresh open while avoiding the per-call sqlite open + schema-migration +
    // close that otherwise blocks the graphd event loop on every GET /project.
    if (resource.isFolderVisibilityOpen()) {
        return expandedFolderPaths(resource.readCurrentFolderState().folderState)
    }
    // Open-sequence window: `bindProject` reads expanded paths (via
    // `setWriteFolderPath`) before `openResources` installs the long-lived
    // handle. Fall back to a one-shot open against the on-disk db.
    return await readExpandedFolderPathsByOneShotOpen(projectRoot)
}

async function readExpandedFolderPathsByOneShotOpen(projectRoot: FilePath): Promise<readonly FilePath[]> {
    const dbModule = await loadFolderVisibilityDbModule()
    const store = await loadFolderVisibilityStore()
    const { ensureDefaultView, getActiveViewId } = await loadViewsRepository()
    const db: FolderVisibilityDatabase = dbModule.openFolderVisibilityDb(projectRoot, dbModule.defaultFolderVisibilityDbDeps)
    try {
        ensureDefaultView(db)
        store.configureFolderVisibilityStore(db)
        const activeViewId: string = getActiveViewId(db)
        return expandedFolderPaths([...store.getFolderVisibility(activeViewId)])
    } finally {
        store.clearFolderVisibilityStoreForTests()
        dbModule.closeFolderVisibilityDb(db)
    }
}

/**
 * Get the topmost expanded folder paths for the active view (watch roots).
 * Uses deriveWatchRoots so nested expanded folders don't add redundant mounts.
 */
export async function getWatchRootsForActiveView(projectRoot: FilePath): Promise<readonly string[]> {
    let dbModule: Awaited<ReturnType<typeof loadFolderVisibilityDbModule>>
    try {
        dbModule = await loadFolderVisibilityDbModule()
    } catch {
        return []
    }
    const store = await loadStoreWithDerivation()
    const { ensureDefaultView, getActiveViewId } = await loadViewsRepository()
    const db: FolderVisibilityDatabase = dbModule.openFolderVisibilityDb(projectRoot, dbModule.defaultFolderVisibilityDbDeps)
    try {
        ensureDefaultView(db)
        store.configureFolderVisibilityStore(db)
        const activeViewId: string = getActiveViewId(db)
        const map = store.getFolderVisibility(activeViewId)
        return [...store.deriveWatchRoots(map)]
    } finally {
        store.clearFolderVisibilityStoreForTests()
        dbModule.closeFolderVisibilityDb(db)
    }
}

async function writeActiveViewFolderState(
    projectRoot: FilePath,
    folderPath: FilePath,
    state: FolderState,
): Promise<void> {
    let dbModule: Awaited<ReturnType<typeof loadFolderVisibilityDbModule>>
    try {
        dbModule = await loadFolderVisibilityDbModule()
    } catch {
        return
    }
    const store = await loadFolderVisibilityStore()
    const { ensureDefaultView, getActiveViewId } = await loadViewsRepository()
    const db: FolderVisibilityDatabase = dbModule.openFolderVisibilityDb(projectRoot, dbModule.defaultFolderVisibilityDbDeps)
    try {
        ensureDefaultView(db)
        store.configureFolderVisibilityStore(db)
        store.setFolderState(getActiveViewId(db), folderPath, state)
    } finally {
        store.clearFolderVisibilityStoreForTests()
        dbModule.closeFolderVisibilityDb(db)
    }
}

/**
 * Set a folder to a *loaded* state (`'expanded'` or `'collapsed'`). The type
 * forbids `'hidden'`: see {@link LoadedFolderState}.
 */
export async function setActiveViewFolderState(
    projectRoot: FilePath,
    folderPath: FilePath,
    state: LoadedFolderState,
): Promise<void> {
    await writeActiveViewFolderState(projectRoot, folderPath, state)
}

/**
 * Mark a folder `'hidden'` in the active view. The DB-write half of the unload
 * transition — call only from `projectAllowlist.removeReadPath`, which purges
 * the folder's graph nodes in the same step so INV-1 holds.
 */
export async function markActiveViewFolderHidden(
    projectRoot: FilePath,
    folderPath: FilePath,
): Promise<void> {
    await writeActiveViewFolderState(projectRoot, folderPath, 'hidden')
}

export async function seedActiveViewExpandedFolderStates(
    projectRoot: FilePath,
    folderPaths: readonly FilePath[],
): Promise<void> {
    let dbModule: Awaited<ReturnType<typeof loadFolderVisibilityDbModule>>
    try {
        dbModule = await loadFolderVisibilityDbModule()
    } catch {
        return
    }
    const store = await loadFolderVisibilityStore()
    const { ensureDefaultView, getActiveViewId } = await loadViewsRepository()
    const db: FolderVisibilityDatabase = dbModule.openFolderVisibilityDb(projectRoot, dbModule.defaultFolderVisibilityDbDeps)
    try {
        ensureDefaultView(db)
        store.configureFolderVisibilityStore(db)
        const activeViewId = getActiveViewId(db)
        const existing = store.getFolderVisibility(activeViewId)
        for (const folderPath of new Set(folderPaths.map((path) => normalizePath(path)))) {
            if (!existing.has(folderPath)) {
                store.setFolderState(activeViewId, folderPath, 'expanded')
            }
        }
    } finally {
        store.clearFolderVisibilityStoreForTests()
        dbModule.closeFolderVisibilityDb(db)
    }
}
