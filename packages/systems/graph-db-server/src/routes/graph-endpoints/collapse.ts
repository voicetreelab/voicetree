import type { Hono } from 'hono'
import { collapseSessionFolderWorkflow } from '@vt/graph-db-server/application/workflows/collapse'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'
import { sendHttpResult } from '../httpResult.ts'

export function mountCollapseRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  mountDaemonRoute(app, daemonRouteSpecById('view.collapse'), async (c) => {
    return sendHttpResult(
      c,
      await collapseSessionFolderWorkflow(
        registry,
        routeParam(c, 'sessionId'),
        routeParam(c, 'folderId'),
        'collapse',
      ),
    )
  })

  mountDaemonRoute(app, daemonRouteSpecById('view.expand'), async (c) => {
    return sendHttpResult(
      c,
      await collapseSessionFolderWorkflow(
        registry,
        routeParam(c, 'sessionId'),
        routeParam(c, 'folderId'),
        'expand',
      ),
    )
  })
}
