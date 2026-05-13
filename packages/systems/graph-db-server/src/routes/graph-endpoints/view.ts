import type { Hono } from 'hono'
import type { WorkflowSessionRegistry } from '../../application/workflows/sessionRoutes.ts'
import {
  addExpandOverrideWorkflow,
  deleteExpandOverrideWorkflow,
  readProjectedGraphWorkflow,
  renderSessionViewWorkflow,
} from '../../application/workflows/view.ts'
import { sendHttpResult } from '../httpResult.ts'

export function mountViewRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  app.get('/sessions/:sessionId/view', async (c) => {
    return sendHttpResult(
      c,
      await renderSessionViewWorkflow(
        registry,
        c.req.param('sessionId'),
        c.req.query('budget'),
        c.req.queries('expand') ?? [],
      ),
    )
  })

  app.get('/sessions/:sessionId/projected-graph', async (c) => {
    return sendHttpResult(
      c,
      await readProjectedGraphWorkflow(registry, c.req.param('sessionId')),
    )
  })

  app.post('/sessions/:sessionId/expand/:folderId', (c) => {
    return sendHttpResult(
      c,
      addExpandOverrideWorkflow(
        registry,
        c.req.param('sessionId'),
        c.req.param('folderId'),
      ),
    )
  })

  app.delete('/sessions/:sessionId/expand/:folderId', (c) => {
    return sendHttpResult(
      c,
      deleteExpandOverrideWorkflow(
        registry,
        c.req.param('sessionId'),
        c.req.param('folderId'),
      ),
    )
  })
}
