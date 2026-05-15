import type { Hono } from 'hono'
import {
  CloneViewRequestSchema,
  CreateViewRequestSchema,
  ListViewsResponseSchema,
  ViewRecordSchema,
} from '@vt/graph-db-server/contract'
import { withVaultMutex } from '@vt/graph-db-server/application/workflows/vaultLifecycle'
import { getCurrentFolderVisibilityDb } from '@vt/graph-db-server/views/folderVisibilityResource'
import { createViewsStore } from '@vt/graph-db-server/views/viewsStore'
import {
  ActiveViewDeleteError,
  ViewNotFoundError,
} from '@vt/graph-db-server/views/viewsRepository'
import { emptyResult, errorResult } from '@vt/graph-db-server/application/workflows/httpResult'
import { sendHttpResult } from '../httpResult.ts'

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

export function mountVaultViewsRoutes(app: Hono): void {
  app.get('/vault/views', (c) => {
    try {
      return c.json(ListViewsResponseSchema.parse(viewStore().listViews()))
    } catch (error) {
      return sendHttpResult(c, toHttpError(error))
    }
  })

  app.post('/vault/views', async (c) => {
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

  app.post('/vault/views/:viewId/activate', async (c) => {
    try {
      const view = await withVaultMutex(async () => {
        const store = viewStore()
        store.switchActiveView(c.req.param('viewId'))
        return store.listViews().find((record) => record.isActive)
      })
      return c.json(ViewRecordSchema.parse(view))
    } catch (error) {
      return sendHttpResult(c, toHttpError(error))
    }
  })

  app.post('/vault/views/:viewId/clone', async (c) => {
    const body = CloneViewRequestSchema.safeParse(await c.req.json())
    if (!body.success) {
      return sendHttpResult(c, errorResult('Invalid request body', 'INVALID_REQUEST_BODY'))
    }

    try {
      const cloned = viewStore().cloneView(c.req.param('viewId'), body.data.name)
      return c.json(ViewRecordSchema.parse({ ...cloned, isActive: false }))
    } catch (error) {
      return sendHttpResult(c, toHttpError(error))
    }
  })

  app.delete('/vault/views/:viewId', (c) => {
    try {
      viewStore().deleteView(c.req.param('viewId'))
      return sendHttpResult(c, emptyResult(200))
    } catch (error) {
      return sendHttpResult(c, toHttpError(error))
    }
  })
}
