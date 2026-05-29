import type { Hono } from 'hono'
import {
  CloneViewRequestSchema,
  CreateViewRequestSchema,
  ListViewsResponseSchema,
  ViewRecordSchema,
} from '@vt/graph-db-server/contract'
import { withProjectMutex } from '@vt/graph-db-server/application/workflows/projectLifecycle'
import { getCurrentFolderVisibilityDb } from '@vt/graph-db-server/views/folderVisibilityResource'
import { createViewsStore } from '@vt/graph-db-server/views/viewsStore'
import {
  ActiveViewDeleteError,
  ViewNotFoundError,
} from '@vt/graph-db-server/views/viewsRepository'
import { emptyResult, errorResult } from '@vt/graph-db-server/application/workflows/httpResult'
import { sendHttpResult } from '../httpResult.ts'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'

function viewStore() {
  return createViewsStore(getCurrentFolderVisibilityDb())
}

function toHttpError(error: unknown) {
  if (error instanceof ActiveViewDeleteError) {
    return errorResult('active view', 'ACTIVE_VIEW', 409)
  }
  if (error instanceof ViewNotFoundError) {
    return errorResult(error.message, 'VIEW_NOT_FOUND', 404)
  }
  return errorResult(
    error instanceof Error ? error.message : 'View operation failed',
    'VIEW_OPERATION_FAILED',
    500,
  )
}

export function mountProjectViewsRoutes(app: Hono): void {
  mountDaemonRoute(app, daemonRouteSpecById('project.views.list'), (c) => {
    try {
      return c.json(ListViewsResponseSchema.parse(viewStore().listViews()))
    } catch (error) {
      return sendHttpResult(c, toHttpError(error))
    }
  })

  mountDaemonRoute(app, daemonRouteSpecById('project.views.create'), async (c) => {
    const body = CreateViewRequestSchema.safeParse(await c.req.json())
    if (!body.success) {
      return sendHttpResult(c, errorResult('Invalid request body', 'INVALID_REQUEST_BODY'))
    }

    try {
      const created = viewStore().createView(body.data.name)
      return c.json(ViewRecordSchema.parse({ ...created, isActive: false }))
    } catch (error) {
      return sendHttpResult(c, toHttpError(error))
    }
  })

  mountDaemonRoute(app, daemonRouteSpecById('project.views.activate'), async (c) => {
    try {
      const view = await withProjectMutex(async () => {
        const store = viewStore()
        store.switchActiveView(routeParam(c, 'viewId'))
        return store.listViews().find((record) => record.isActive)
      })
      return c.json(ViewRecordSchema.parse(view))
    } catch (error) {
      return sendHttpResult(c, toHttpError(error))
    }
  })

  mountDaemonRoute(app, daemonRouteSpecById('project.views.clone'), async (c) => {
    const body = CloneViewRequestSchema.safeParse(await c.req.json())
    if (!body.success) {
      return sendHttpResult(c, errorResult('Invalid request body', 'INVALID_REQUEST_BODY'))
    }

    try {
      const cloned = viewStore().cloneView(routeParam(c, 'viewId'), body.data.name)
      return c.json(ViewRecordSchema.parse({ ...cloned, isActive: false }))
    } catch (error) {
      return sendHttpResult(c, toHttpError(error))
    }
  })

  mountDaemonRoute(app, daemonRouteSpecById('project.views.delete'), (c) => {
    try {
      viewStore().deleteView(routeParam(c, 'viewId'))
      return sendHttpResult(c, emptyResult(200))
    } catch (error) {
      return sendHttpResult(c, toHttpError(error))
    }
  })
}
