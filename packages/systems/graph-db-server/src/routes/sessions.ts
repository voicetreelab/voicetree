import type { Hono } from 'hono'
import {
  SessionCreateResponseSchema,
  SessionInfoSchema,
} from '../contract.ts'
import { SessionRegistry } from '../session/registry.ts'

export function mountSessionRoutes(
  app: Hono,
  registry: SessionRegistry,
): void {
  app.post('/sessions', (c) => {
    const session = registry.create()
    const body = SessionCreateResponseSchema.parse({ sessionId: session.id })
    return c.json(body, 201)
  })

  app.delete('/sessions/:sessionId', (c) => {
    const deleted = registry.delete(c.req.param('sessionId'))
    if (!deleted) {
      return c.notFound()
    }
    return c.body(null, 204)
  })

  app.get('/sessions/:sessionId', (c) => {
    const session = registry.get(c.req.param('sessionId'))
    if (!session) {
      return c.notFound()
    }

    const body = SessionInfoSchema.parse({
      id: session.id,
      lastAccessedAt: session.lastAccessedAt,
      collapseSetSize: session.collapseSet.size,
      selectionSize: session.selection.size,
    })
    return c.json(body)
  })
}
