import type { Hono } from 'hono'
import {
  createSessionWorkflow,
  deleteSessionWorkflow,
  readSessionWorkflow,
  type WorkflowSessionRegistry,
} from '../../application/workflows/sessionRoutes.ts'
import { sendHttpResult } from '../httpResult.ts'

export function mountSessionRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  app.post('/sessions', (c) => {
    return sendHttpResult(c, createSessionWorkflow(registry))
  })

  app.delete('/sessions/:sessionId', (c) => {
    return sendHttpResult(c, deleteSessionWorkflow(registry, c.req.param('sessionId')))
  })

  app.get('/sessions/:sessionId', (c) => {
    return sendHttpResult(c, readSessionWorkflow(registry, c.req.param('sessionId')))
  })
}
