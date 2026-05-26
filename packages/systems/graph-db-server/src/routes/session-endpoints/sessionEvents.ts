import type { Hono } from 'hono'
import { stream } from 'hono/streaming'
import {
  runSessionEventsWorkflow,
  sessionExistsWorkflow,
  type SessionEventTimers,
} from '@vt/graph-db-server/application/workflows/session/sessionEvents'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/session/sessionRoutes'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'

function getDefaultSessionEventTimers(): SessionEventTimers {
  return {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  }
}

export function mountSessionEventsRoute(
  app: Hono,
  registry: WorkflowSessionRegistry,
  timers: SessionEventTimers = getDefaultSessionEventTimers(),
): void {
  mountDaemonRoute(app, daemonRouteSpecById('session.events'), (c) => {
    const sessionId = routeParam(c, 'sessionId')
    if (!sessionExistsWorkflow(registry, sessionId)) {
      return c.notFound()
    }

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')

    return stream(c, async (s) => {
      await runSessionEventsWorkflow({
        registry,
        sessionId,
        since: c.req.query('since'),
        timers,
        stream: {
          write: async (chunk) => {
            await s.write(chunk)
          },
          onAbort: (callback) => s.onAbort(callback),
        },
      })
    })
  })
}
