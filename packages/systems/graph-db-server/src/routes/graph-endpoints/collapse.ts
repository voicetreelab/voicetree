import type { Hono } from 'hono'
import { collapseSessionFolderWorkflow } from '../../application/workflows/collapse.ts'
import type { WorkflowSessionRegistry } from '../../application/workflows/sessionRoutes.ts'
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
