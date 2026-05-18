import type { Hono } from 'hono'
import {
  FolderStateBatchRequestSchema,
  FolderStatePatchRequestSchema,
  FolderStateResponseSchema,
  type FolderState,
  type FolderStateBatchUpdate,
} from '@vt/graph-db-server/contract'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { getProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import {
  readCurrentFolderState,
  updateCurrentFolderState,
  updateCurrentFolderStateBatch,
} from '@vt/graph-db-server/views/folderVisibilityResource'
import { errorResult, jsonResult, notFoundResult } from '@vt/graph-db-server/application/workflows/httpResult'
import { sendHttpResult } from '../httpResult.ts'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'
import type { Session } from '../../application/session/types.ts'

function decodePath(raw: string): string | null {
  try {
    return decodeURIComponent(raw)
  } catch {
    return null
  }
}

function vaultMustBeOpen() {
  return getProjectRootWatchedDirectory()
    ? null
    : errorResult('No vault is currently open', 'vault_not_open', 409)
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

export function mountFolderStateRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  mountDaemonRoute(app, daemonRouteSpecById('session.folder-state.read'), (c) => {
    if (!registry.get(routeParam(c, 'sessionId'))) {
      return sendHttpResult(c, notFoundResult())
    }
    const vaultError = vaultMustBeOpen()
    if (vaultError) return sendHttpResult(c, vaultError)

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
    const vaultError = vaultMustBeOpen()
    if (vaultError) return sendHttpResult(c, vaultError)

    const path = decodePath(routeParam(c, 'encodedPath'))
    if (!path) {
      return sendHttpResult(c, errorResult('Invalid encoded path', 'INVALID_PATH_ENCODING'))
    }
    const body = FolderStatePatchRequestSchema.safeParse(await c.req.json())
    if (!body.success) {
      return sendHttpResult(c, errorResult('Invalid request body', 'INVALID_REQUEST_BODY'))
    }

    syncSessionCollapseSet(session, path, body.data.state)
    return sendHttpResult(
      c,
      jsonResult(
        FolderStateResponseSchema.parse(updateCurrentFolderState(path, body.data.state)),
      ),
    )
  })

  mountDaemonRoute(app, daemonRouteSpecById('session.folder-state.batch'), async (c) => {
    const session = registry.get(routeParam(c, 'sessionId'))
    if (!session) {
      return sendHttpResult(c, notFoundResult())
    }
    const vaultError = vaultMustBeOpen()
    if (vaultError) return sendHttpResult(c, vaultError)

    const body = FolderStateBatchRequestSchema.safeParse(await c.req.json())
    if (!body.success) {
      return sendHttpResult(c, errorResult('Invalid request body', 'INVALID_REQUEST_BODY'))
    }

    syncSessionCollapseSetBatch(session, body.data.updates)
    return sendHttpResult(
      c,
      jsonResult(
        FolderStateResponseSchema.parse(updateCurrentFolderStateBatch(body.data.updates)),
      ),
    )
  })
}
