import type { Hono } from 'hono'
import { updateSelectionWorkflow } from '@vt/graph-db-server/application/workflows/selection'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { sendHttpResult } from '../httpResult.ts'

export function mountSelectionRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  app.post('/sessions/:sessionId/selection', async (c) => {
    return sendHttpResult(
      c,
      updateSelectionWorkflow(registry, c.req.param('sessionId'), await c.req.json()),
    )
  })
}
