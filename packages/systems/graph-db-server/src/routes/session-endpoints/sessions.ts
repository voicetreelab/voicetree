import type { Hono } from 'hono'
import {
  createSessionWorkflow,
  deleteSessionWorkflow,
  readSessionWorkflow,
  type WorkflowSessionRegistry,
} from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'
import { sendHttpResult } from '../httpResult.ts'

export function mountSessionRoutes(
  app: Hono,
  registry: WorkflowSessionRegistry,
): void {
  mountDaemonRoute(app, daemonRouteSpecById('session.create'), (c) => {
    return sendHttpResult(c, createSessionWorkflow(registry))
  })

  mountDaemonRoute(app, daemonRouteSpecById('session.delete'), (c) => {
    return sendHttpResult(c, deleteSessionWorkflow(registry, routeParam(c, 'sessionId')))
  })

  mountDaemonRoute(app, daemonRouteSpecById('session.show'), (c) => {
    return sendHttpResult(c, readSessionWorkflow(registry, routeParam(c, 'sessionId')))
  })
}
