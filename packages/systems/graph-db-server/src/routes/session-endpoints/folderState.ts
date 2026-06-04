import type { Hono } from 'hono'
import {
  FolderStateBatchRequestSchema,
  FolderStatePatchRequestSchema,
  FolderStateResponseSchema,
  type FolderState,
  type FolderStateBatchUpdate,
} from '@vt/graph-db-server/contract'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { getProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import {
  readCurrentFolderState,
  updateCurrentFolderState,
  updateCurrentFolderStateBatch,
  type LoadedFolderState,
} from '@vt/graph-db-server/views/folderVisibilityResource'
import { errorResult, jsonResult, notFoundResult } from '@vt/graph-db-server/application/workflows/httpResult'
import { executeCommand } from '@vt/graph-db-server/application/workflows/dispatch'
import { sendHttpResult } from '../httpResult.ts'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'
import type { Session } from '@vt/graph-db-server/application/session/types'

function decodePath(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

function projectMustBeOpen() {
  return getProjectRoot()
    ? null
    : errorResult('No project is currently open', 'project_not_open', 409)
}

function normalizeFolderId(path: string): string {
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

function syncSessionCollapseSet(session: Session, path: string, state: FolderState): void {
  const folderId = normalizeFolderId(path)
  session.folderState.set(path, state)
  if (state === 'collapsed') {
    session.collapseSet.add(folderId)
    return
  }
  session.collapseSet.delete(folderId)
}

function syncSessionCollapseSetBatch(
  session: Session,
  updates: readonly FolderStateBatchUpdate[],
): void {
  for (const update of updates) {
    syncSessionCollapseSet(session, update.path, update.state)
  }
}

/**
 * Push a fresh projection to this session's live renderers after a folder-state
 * write. Required because `'collapsed'` (and a `'collapsed' -> 'expanded'` flip
 * on an already-loaded folder) changes the *projection* without changing the
 * *node set*, so no graph delta fires on the delta bus and the SSE stream would
 * otherwise never re-project. Re-running it for `'expanded'`/`'hidden'` is a
 * harmless idempotent re-render (the SSE layer coalesces bursts), so we broadcast
 * unconditionally rather than try to predict which transitions skipped a delta.
 */
async function broadcastProjection(session: Session): Promise<void> {
  await executeCommand({ type: 'ProjectAndBroadcast', session })
}

/**
 * Apply the graph-loaded-state side of a folder-state change and report how many
 * nodes a `'hidden'` transition purged. `'hidden'` is routed exclusively through
 * the unload transition (`RemoveProjectReadPath`), which is the single funnel
 * that writes `'hidden'` visibility AND purges the folder's nodes (INV-1).
 */
async function syncGraphLoadedState(
  path: string,
  state: FolderState,
): Promise<{ removedNodeCount: number }> {
  if (state === 'expanded') {
    await executeCommand({ type: 'AddProjectReadPath', path })
    return { removedNodeCount: 0 }
  }
  if (state === 'hidden') {
    const result = await executeCommand({ type: 'RemoveProjectReadPath', path })
    return { removedNodeCount: result.removedNodeCount }
  }
  return { removedNodeCount: 0 }
}

export function mountFolderStateRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  mountDaemonRoute(app, daemonRouteSpecById('session.folder-state.read'), (c) => {
    if (!registry.get(routeParam(c, 'sessionId'))) {
      return sendHttpResult(c, notFoundResult())
    }
    const projectError = projectMustBeOpen()
    if (projectError) return sendHttpResult(c, projectError)

    return sendHttpResult(
      c,
      jsonResult(FolderStateResponseSchema.parse(readCurrentFolderState())),
    )
  })

  mountDaemonRoute(app, daemonRouteSpecById('session.folder-state.set'), async (c) => {
    const session = registry.get(routeParam(c, 'sessionId'))
    if (!session) {
      return sendHttpResult(c, notFoundResult())
    }
    const projectError = projectMustBeOpen()
    if (projectError) return sendHttpResult(c, projectError)

    const path = decodePath(routeParam(c, 'encodedPath'))
    if (!path) {
      return sendHttpResult(c, errorResult('Invalid encoded path', 'INVALID_PATH_ENCODING'))
    }
    const body = FolderStatePatchRequestSchema.safeParse(await c.req.json())
    if (!body.success) {
      return sendHttpResult(c, errorResult('Invalid request body', 'INVALID_REQUEST_BODY'))
    }

    const state = body.data.state
    const { removedNodeCount } = await syncGraphLoadedState(path, state)
    syncSessionCollapseSet(session, path, state)
    // The unload transition is the sole writer of `'hidden'` visibility; route
    // only the loaded states through the DB-only resource writer.
    const snapshot =
      state === 'hidden'
        ? { ...readCurrentFolderState(), removedNodeCount }
        : updateCurrentFolderState(path, state)
    await broadcastProjection(session)
    return sendHttpResult(c, jsonResult(FolderStateResponseSchema.parse(snapshot)))
  })

  mountDaemonRoute(app, daemonRouteSpecById('session.folder-state.batch'), async (c) => {
    const session = registry.get(routeParam(c, 'sessionId'))
    if (!session) {
      return sendHttpResult(c, notFoundResult())
    }
    const projectError = projectMustBeOpen()
    if (projectError) return sendHttpResult(c, projectError)

    const body = FolderStateBatchRequestSchema.safeParse(await c.req.json())
    if (!body.success) {
      return sendHttpResult(c, errorResult('Invalid request body', 'INVALID_REQUEST_BODY'))
    }

    let removedNodeCount = 0
    for (const update of body.data.updates) {
      const synced = await syncGraphLoadedState(update.path, update.state)
      removedNodeCount += synced.removedNodeCount
    }
    syncSessionCollapseSetBatch(session, body.data.updates)
    // `'hidden'` updates already had their visibility written by the unload
    // transition; only the loaded states go through the DB-only batch writer.
    const loadedUpdates = body.data.updates.filter(
      (update): update is FolderStateBatchUpdate & { state: LoadedFolderState } =>
        update.state !== 'hidden',
    )
    const snapshot =
      loadedUpdates.length > 0
        ? updateCurrentFolderStateBatch(loadedUpdates)
        : readCurrentFolderState()
    await broadcastProjection(session)
    return sendHttpResult(
      c,
      jsonResult(FolderStateResponseSchema.parse({ ...snapshot, removedNodeCount })),
    )
  })
}
