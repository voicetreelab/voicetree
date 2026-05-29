import {
  clearFolderVisibilityStoreForTests,
  configureFolderVisibilityStore,
  getFolderVisibility,
  setFolderState,
  setFolderStateBatch,
} from '@vt/graph-state'
import type { FolderState } from '@vt/graph-db-server/contract'
import type { FilePath } from '@vt/graph-model/graph'
import {
  closeFolderVisibilityDb,
  defaultFolderVisibilityDbDeps,
  openFolderVisibilityDb,
  type FolderVisibilityDatabase,
} from './folderVisibilitySqlite'
import { ensureDefaultView, getActiveViewId } from './viewsRepository'
import {
  freshProject,
  getProject,
  mutateProject,
  updateProject,
  type ProjectState,
} from '@vt/graph-db-server/application/workflows/state/projectState'

export type ActiveViewInfo = {
  readonly viewId: string
  readonly name: string
}

export type FolderStateEntry = readonly [path: string, state: FolderState]

export type FolderStateUpdate = {
  readonly path: string
  readonly state: FolderState
}

type ViewNameRow = { readonly name: string }

function readDb(): FolderVisibilityDatabase | null {
  const handle = getProject()?.folderVisibility
  return handle ? (handle.db as FolderVisibilityDatabase) : null
}

export async function openFolderVisibilityForVault(vaultPath: string): Promise<void> {
  await closeFolderVisibilityForVault()
  const db = openFolderVisibilityDb(vaultPath, defaultFolderVisibilityDbDeps)
  ensureDefaultView(db)
  configureFolderVisibilityStore(db as never)
  updateProject((prev: ProjectState | null): ProjectState => {
    const base = prev ?? freshProject(vaultPath as FilePath)
    return {
      ...base,
      folderVisibility: { projectRoot: vaultPath as FilePath, db },
    }
  })
}

export async function closeFolderVisibilityForVault(): Promise<void> {
  const previous = getProject()?.folderVisibility ?? null
  mutateProject((prev: ProjectState): ProjectState => ({
    ...prev,
    folderVisibility: null,
  }))
  clearFolderVisibilityStoreForTests()
  if (previous) {
    closeFolderVisibilityDb(previous.db as FolderVisibilityDatabase)
  }
}

export function getCurrentFolderVisibilityDb(): FolderVisibilityDatabase {
  const db = readDb()
  if (!db) {
    throw new Error('No folder visibility database is open for the current vault')
  }
  configureFolderVisibilityStore(db as never)
  return db
}

function readActiveView(db: FolderVisibilityDatabase): ActiveViewInfo {
  const viewId = getActiveViewId(db)
  const row = db
    .prepare('SELECT name FROM views WHERE view_id = ?')
    .get(viewId) as ViewNameRow | undefined
  if (!row) {
    throw new Error(`active view ${viewId} not found in views table`)
  }
  return { viewId, name: row.name }
}

export function readCurrentFolderState(): {
  folderState: FolderStateEntry[]
  activeView: ActiveViewInfo
} {
  const db = getCurrentFolderVisibilityDb()
  const activeView = readActiveView(db)
  return {
    folderState: [...getFolderVisibility(activeView.viewId)] as FolderStateEntry[],
    activeView,
  }
}

export function updateCurrentFolderState(
  path: string,
  state: FolderState,
): {
  folderState: FolderStateEntry[]
  activeView: ActiveViewInfo
} {
  const db = getCurrentFolderVisibilityDb()
  const activeView = readActiveView(db)
  setFolderState(activeView.viewId, path, state)
  return readCurrentFolderState()
}

export function updateCurrentFolderStateBatch(
  updates: readonly FolderStateUpdate[],
): {
  folderState: FolderStateEntry[]
  activeView: ActiveViewInfo
} {
  const db = getCurrentFolderVisibilityDb()
  const activeView = readActiveView(db)
  setFolderStateBatch(activeView.viewId, updates)
  return readCurrentFolderState()
}
