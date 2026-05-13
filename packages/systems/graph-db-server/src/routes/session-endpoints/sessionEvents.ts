import type { Hono } from 'hono'
import { stream } from 'hono/streaming'
import {
  runSessionEventsWorkflow,
  sessionExistsWorkflow,
  type SessionEventTimers,
} from '../../application/workflows/sessionEvents.ts'
import type { WorkflowSessionRegistry } from '../../application/workflows/sessionRoutes.ts'

export function mountSessionEventsRoute(
  app: Hono,
  registry: WorkflowSessionRegistry,
  timers: SessionEventTimers = {
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  },
): void {
  app.get('/sessions/:sessionId/events', (c) => {
    const sessionId = c.req.param('sessionId')
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
