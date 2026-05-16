import {
  clearFolderVisibilityStoreForTests,
  configureFolderVisibilityStore,
  getFolderVisibility,
  setFolderState,
  setFolderStateBatch,
} from '@vt/graph-state'
import type { FolderState } from '@vt/graph-db-protocol'
import {
  closeFolderVisibilityDb,
  openFolderVisibilityDb,
  type FolderVisibilityDatabase,
} from './folderVisibilitySqlite'
import { ensureDefaultView, getActiveViewId } from './viewsRepository'

export type ActiveViewInfo = {
  readonly viewId: string
  readonly name: string
}

export type FolderStateEntry = readonly [path: string, state: FolderState]

export type FolderStateUpdate = {
  readonly path: string
  readonly state: FolderState
}

type CurrentFolderVisibility = {
  readonly vaultPath: string
  readonly db: FolderVisibilityDatabase
}

type ViewNameRow = { readonly name: string }

let current: CurrentFolderVisibility | null = null

export async function openFolderVisibilityForVault(vaultPath: string): Promise<void> {
  await closeFolderVisibilityForVault()
  const db = openFolderVisibilityDb(vaultPath)
  ensureDefaultView(db)
  configureFolderVisibilityStore(db as never)
  current = { vaultPath, db }
}

export async function closeFolderVisibilityForVault(): Promise<void> {
  const previous = current
  current = null
  clearFolderVisibilityStoreForTests()
  if (previous) {
    closeFolderVisibilityDb(previous.db)
  }
}

export function getCurrentFolderVisibilityDb(): FolderVisibilityDatabase {
  if (!current) {
    throw new Error('No folder visibility database is open for the current vault')
  }
  configureFolderVisibilityStore(current.db as never)
  return current.db
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
