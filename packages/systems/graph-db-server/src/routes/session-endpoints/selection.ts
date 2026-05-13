import type { Hono } from 'hono'
import { updateSelectionWorkflow } from '../../application/workflows/selection.ts'
import type { WorkflowSessionRegistry } from '../../application/workflows/sessionRoutes.ts'
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
