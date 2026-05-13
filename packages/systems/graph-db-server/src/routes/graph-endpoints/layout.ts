import type { Hono } from 'hono'
import {
  updateLayoutWorkflow,
} from '../../application/workflows/layout.ts'
import type { WorkflowSessionRegistry } from '../../application/workflows/sessionRoutes.ts'
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
