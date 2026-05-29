import { Hono } from 'hono'
import { context, propagation } from '@opentelemetry/api'
import {
  HealthResponseSchema,
  ShutdownResponseSchema,
  type HealthResponse,
} from '@vt/graph-db-server/contract'
import { createGraphRoutes } from './graph-endpoints/graph.ts'
import { mountLayoutRoutes } from './graph-endpoints/layout.ts'
import { mountFolderStateRoutes } from './session-endpoints/folderState.ts'
import { mountSelectionRoutes } from './session-endpoints/selection.ts'
import { mountSessionStateRoutes } from './session-endpoints/sessionState.ts'
import { mountProjectRoutes } from './graph-endpoints/project.ts'
import { mountProjectViewsRoutes } from './graph-endpoints/projectViews.ts'
import { mountSessionRoutes } from './session-endpoints/sessions.ts'
import { mountSessionEventsRoute } from './session-endpoints/sessionEvents.ts'
import { mountViewRoutes } from './graph-endpoints/view.ts'
import { type SessionRegistry } from '../application/session/registry.ts'
import { mountDaemonRoute } from './mountRouteSpec.ts'
import { daemonRouteSpecBySignature } from './routeSpecs.ts'

export type CreateDaemonAppOptions = {
  onShutdown: () => void
  readHealth: () => HealthResponse
  registry: SessionRegistry
}

/**
 * Extracts the incoming W3C `traceparent` (+ baggage) header into an OTel
 * context that wraps the rest of the request lifecycle. Any spans started
 * inside the handler — `daemon.open-project`, `daemon.set-write-path.*`, etc —
 * will then attach to the caller's trace instead of starting a new root.
 */
function attachIncomingTraceContext(app: Hono): void {
  app.use('*', async (c, next) => {
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(c.req.header())) {
      if (typeof value === 'string') headers[key] = value
    }
    const ctx = propagation.extract(context.active(), headers)
    await context.with(ctx, next)
  })
}

export function mountDaemonRoutes(
  app: Hono,
  opts: CreateDaemonAppOptions,
): void {
  attachIncomingTraceContext(app)
  mountSessionRoutes(app, opts.registry)
  mountSessionEventsRoute(app, opts.registry)
  mountSessionStateRoutes(app, opts.registry)
  mountFolderStateRoutes(app, opts.registry)
  mountSelectionRoutes(app, opts.registry)
  mountLayoutRoutes(app, opts.registry)
  mountViewRoutes(app, opts.registry)

  mountDaemonRoute(app, daemonRouteSpecBySignature('GET', '/health'), (c) => {
    return c.json(HealthResponseSchema.parse(opts.readHealth()))
  })

  mountDaemonRoute(app, daemonRouteSpecBySignature('POST', '/shutdown'), (c) => {
    opts.onShutdown()
    return c.json(ShutdownResponseSchema.parse({ ok: true }))
  })

  app.route('/graph', createGraphRoutes(opts.registry))
  mountProjectRoutes(app)
  mountProjectViewsRoutes(app)
}

export function createDaemonApp(opts: CreateDaemonAppOptions): Hono {
  const app = new Hono()
  mountDaemonRoutes(app, opts)
  return app
}
