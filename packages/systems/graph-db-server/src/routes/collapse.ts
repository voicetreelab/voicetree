import { dispatchCollapse, dispatchExpand } from '@vt/graph-state/state/collapseSetStore'
import type { Hono } from 'hono'
import { SessionRegistry } from '../session/registry.ts'
import { projectAndBroadcast } from '../session/projectAndBroadcast.ts'

export function mountCollapseRoutes(
  app: Hono,
  registry: SessionRegistry,
): void {
  app.post('/sessions/:sessionId/collapse/:folderId', async (c) => {
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

    await projectAndBroadcast(session)
    return c.json({ collapseSet: [...session.collapseSet] })
  })

  app.delete('/sessions/:sessionId/collapse/:folderId', async (c) => {
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

    await projectAndBroadcast(session)
    return c.json({ collapseSet: [...session.collapseSet] })
  })
}
