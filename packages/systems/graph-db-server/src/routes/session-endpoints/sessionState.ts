import type { Hono } from 'hono'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/session/sessionRoutes'
import { readSessionStateWorkflow } from '@vt/graph-db-server/application/workflows/session/sessionState'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'
import { sendHttpResult } from '../httpResult.ts'

export function mountSessionStateRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  mountDaemonRoute(app, daemonRouteSpecById('view.show'), async (c) => {
    return sendHttpResult(
      c,
      await readSessionStateWorkflow(
        registry,
        routeParam(c, 'sessionId'),
        c.req.query('content'),
      ),
    )
  })
}
