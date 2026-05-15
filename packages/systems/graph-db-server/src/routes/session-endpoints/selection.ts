import type { Hono } from 'hono'
import { updateSelectionWorkflow } from '@vt/graph-db-server/application/workflows/selection'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'
import { sendHttpResult } from '../httpResult.ts'

export function mountSelectionRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  mountDaemonRoute(app, daemonRouteSpecById('view.selection'), async (c) => {
    return sendHttpResult(
      c,
      await updateSelectionWorkflow(
        registry,
        routeParam(c, 'sessionId'),
        await c.req.json(),
      ),
    )
  })
}
