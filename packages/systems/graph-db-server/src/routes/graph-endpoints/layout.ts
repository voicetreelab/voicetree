import type { Hono } from 'hono'
import { updateLayoutWorkflow } from '@vt/graph-db-server/application/workflows/layout'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'
import { sendHttpResult } from '../httpResult.ts'

export function mountLayoutRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  mountDaemonRoute(app, daemonRouteSpecById('view.layout'), async (c) => {
    return sendHttpResult(
      c,
      await updateLayoutWorkflow(
        registry,
        routeParam(c, 'sessionId'),
        await c.req.json(),
      ),
    )
  })
}
