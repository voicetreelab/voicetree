import type { Hono } from 'hono'
import {
  updateLayoutWorkflow,
} from '@vt/graph-db-server/application/workflows/layout'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { sendHttpResult } from '../httpResult.ts'

export function mountLayoutRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  app.put('/sessions/:sessionId/layout', async (c) => {
    return sendHttpResult(
      c,
      updateLayoutWorkflow(registry, c.req.param('sessionId'), await c.req.json()),
    )
  })
}
