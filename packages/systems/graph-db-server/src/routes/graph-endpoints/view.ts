import type { Hono } from 'hono'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import {
  addExpandOverrideWorkflow,
  deleteExpandOverrideWorkflow,
  readProjectedGraphWorkflow,
  renderSessionViewWorkflow,
} from '@vt/graph-db-server/application/workflows/view'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById, daemonRouteSpecBySignature } from '../routeSpecs.ts'
import { sendHttpResult } from '../httpResult.ts'

export function mountViewRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  mountDaemonRoute(app, daemonRouteSpecById('graph.view'), async (c) => {
    return sendHttpResult(
      c,
      await renderSessionViewWorkflow(
        registry,
        routeParam(c, 'sessionId'),
        c.req.query('budget'),
        c.req.query('title'),
        c.req.queries('expand') ?? [],
      ),
    )
  })

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature(
      'GET',
      '/sessions/:sessionId/projected-graph',
    ),
    async (c) => {
      return sendHttpResult(
        c,
        await readProjectedGraphWorkflow(registry, routeParam(c, 'sessionId')),
      )
    },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature(
      'POST',
      '/sessions/:sessionId/expand/:folderId',
    ),
    async (c) => {
      return sendHttpResult(
        c,
        await addExpandOverrideWorkflow(
          registry,
          routeParam(c, 'sessionId'),
          routeParam(c, 'folderId'),
        ),
      )
    },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature(
      'DELETE',
      '/sessions/:sessionId/expand/:folderId',
    ),
    async (c) => {
      return sendHttpResult(
        c,
        await deleteExpandOverrideWorkflow(
          registry,
          routeParam(c, 'sessionId'),
          routeParam(c, 'folderId'),
        ),
      )
    },
  )
}
