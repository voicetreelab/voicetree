import type { Hono } from 'hono'
import { stream } from 'hono/streaming'
import type { SessionRegistry } from '../session/registry.ts'
import { subscribe, type SourceTaggedDelta } from '../events/deltaEventBus.ts'

function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

function stringifyEventForSSE(event: SourceTaggedDelta): string {
  return JSON.stringify(event, (_key: string, value: unknown) => {
    if (value instanceof Map) {
      return Object.fromEntries(value.entries())
    }
    return value
  })
}

export function mountSessionEventsRoute(
  app: Hono,
  registry: SessionRegistry,
): void {
  app.get('/sessions/:sessionId/events', (c) => {
    const sessionId = c.req.param('sessionId')
    const session = registry.get(sessionId)
    if (!session) {
      return c.notFound()
    }

    c.header('Content-Type', 'text/event-stream')
    c.header('Cache-Control', 'no-cache')
    c.header('Connection', 'keep-alive')

    return stream(c, async (s) => {
      // Send initial comment to flush headers to client
      await s.write(': connected\n\n')

      let unsubscribe: (() => void) | null = null

      const onEvent = (event: SourceTaggedDelta): void => {
        void s.write(formatSSE('graphDelta', stringifyEventForSSE(event)))
      }

      unsubscribe = subscribe(onEvent)

      s.onAbort(() => {
        unsubscribe?.()
        unsubscribe = null
      })

      await new Promise<void>((resolve) => {
        s.onAbort(() => resolve())
      })
    })
  })
}
