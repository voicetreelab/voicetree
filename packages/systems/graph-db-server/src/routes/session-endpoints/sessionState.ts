import type { Hono } from 'hono'
import type { WorkflowSessionRegistry } from '../../application/workflows/sessionRoutes.ts'
import { readSessionStateWorkflow } from '../../application/workflows/sessionState.ts'
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
