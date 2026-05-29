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

export async function openFolderVisibilityForProject(projectPath: string): Promise<void> {
  await closeFolderVisibilityForProject()
  const db = openFolderVisibilityDb(projectPath, defaultFolderVisibilityDbDeps)
  ensureDefaultView(db)
  configureFolderVisibilityStore(db as never)
  updateProject((prev: ProjectState | null): ProjectState => {
    const base = prev ?? freshProject(projectPath as FilePath)
    return {
      ...base,
      folderVisibility: { projectRoot: projectPath as FilePath, db },
    }
  })
}

export async function closeFolderVisibilityForProject(): Promise<void> {
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
    throw new Error('No folder visibility database is open for the current project')
  }
  configureFolderVisibilityStore(db as never)
  return db
}

/**
 * Whether the long-lived folder-visibility db handle is currently open.
 *
 * `getProjectRoot()` becomes truthy during `bindProject` BEFORE `openResources`
 * opens this handle, so callers that read folder state outside the open
 * lifecycle (e.g. `session show`) must gate on the handle itself, not just the
 * project root, to avoid throwing during that transient window.
 */
export function isFolderVisibilityOpen(): boolean {
  return readDb() !== null
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
