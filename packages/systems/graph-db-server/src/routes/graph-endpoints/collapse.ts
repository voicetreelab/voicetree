import type { Hono } from 'hono'
import { collapseSessionFolderWorkflow } from '@vt/graph-db-server/application/workflows/collapse'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { sendHttpResult } from '../httpResult.ts'

export function mountCollapseRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  app.post('/sessions/:sessionId/collapse/:folderId', async (c) => {
    return sendHttpResult(
      c,
      await collapseSessionFolderWorkflow(
        registry,
        c.req.param('sessionId'),
        c.req.param('folderId'),
        'collapse',
      ),
    )
  })

  app.delete('/sessions/:sessionId/collapse/:folderId', async (c) => {
    return sendHttpResult(
      c,
      await collapseSessionFolderWorkflow(
        registry,
        c.req.param('sessionId'),
        c.req.param('folderId'),
        'expand',
      ),
    )
  })
}
