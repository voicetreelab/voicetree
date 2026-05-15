import type { Hono } from 'hono'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { readSessionStateWorkflow } from '@vt/graph-db-server/application/workflows/sessionState'
import { sendHttpResult } from '../httpResult.ts'

export function mountSessionStateRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  app.get('/sessions/:sessionId/state', async (c) => {
    return sendHttpResult(
      c,
      await readSessionStateWorkflow(
        registry,
        c.req.param('sessionId'),
        c.req.query('content'),
      ),
    )
  })
}
