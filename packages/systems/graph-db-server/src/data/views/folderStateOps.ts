import {
  closeFolderVisibilityDb,
  defaultFolderVisibilityDbDeps,
  openFolderVisibilityDb,
  type FolderVisibilityDatabase,
} from './folderVisibilitySqlite'
import {
  ensureDefaultView,
  getActiveViewId,
} from './viewsRepository'
import type { FolderState } from '@vt/graph-db-server/contract'

export type ActiveViewInfo = {
  readonly viewId: string
  readonly name: string
}

export type FolderStateEntry = readonly [path: string, state: FolderState]

type ViewNameRow = { readonly name: string }
type FolderStateRow = { readonly path: string; readonly state: FolderState }

function withDb<T>(projectRoot: string, fn: (db: FolderVisibilityDatabase) => T): T {
  const db = openFolderVisibilityDb(projectRoot, defaultFolderVisibilityDbDeps)
  try {
    ensureDefaultView(db)
    return fn(db)
  } finally {
    closeFolderVisibilityDb(db)
  }
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

function readFolderState(
  db: FolderVisibilityDatabase,
  viewId: string,
): FolderStateEntry[] {
  const rows = db
    .prepare(
      'SELECT path, state FROM folder_visibility WHERE view_id = ? ORDER BY path ASC',
    )
    .all(viewId) as FolderStateRow[]
  return rows.map((row): FolderStateEntry => [row.path, row.state])
}

export function getActiveView(projectRoot: string): ActiveViewInfo {
  return withDb(projectRoot, (db) => readActiveView(db))
}

export function getFolderStateForActiveView(
  projectRoot: string,
): {
  folderState: FolderStateEntry[]
  activeView: ActiveViewInfo
} {
  return withDb(projectRoot, (db) => {
    const activeView = readActiveView(db)
    return {
      folderState: readFolderState(db, activeView.viewId),
      activeView,
    }
  })
}

