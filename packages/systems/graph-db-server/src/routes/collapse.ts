import { dispatchCollapse, dispatchExpand } from '@vt/graph-state/state/collapseSetStore'
import type { Hono } from 'hono'
import { CollapseStateResponseSchema } from '../contract.ts'
import { SessionRegistry } from '../session/registry.ts'

function buildCollapseStateResponse(collapseSet: Set<string>) {
  return CollapseStateResponseSchema.parse({
    collapseSet: [...collapseSet],
  })
}

export function mountCollapseRoutes(
  app: Hono,
  registry: SessionRegistry,
): void {
  app.post('/sessions/:sessionId/collapse/:folderId', (c) => {
    const sessionId = c.req.param('sessionId')
    const session = registry.get(sessionId)
    if (!session) {
      return c.notFound()
    }

    session.collapseSet = dispatchCollapse(
      session.collapseSet,
      c.req.param('folderId'),
    )
    registry.touch(sessionId)

    return c.json(buildCollapseStateResponse(session.collapseSet))
  })

  app.delete('/sessions/:sessionId/collapse/:folderId', (c) => {
    const sessionId = c.req.param('sessionId')
    const session = registry.get(sessionId)
    if (!session) {
      return c.notFound()
    }

    session.collapseSet = dispatchExpand(
      session.collapseSet,
      c.req.param('folderId'),
    )
    registry.touch(sessionId)

    return c.json(buildCollapseStateResponse(session.collapseSet))
  })
}
