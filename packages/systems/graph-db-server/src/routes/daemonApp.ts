import { Hono } from 'hono'
import {
  HealthResponseSchema,
  ShutdownResponseSchema,
  type HealthResponse,
} from '../daemon/contract.ts'
import { mountCollapseRoutes } from './graph-endpoints/collapse.ts'
import { createGraphRoutes } from './graph-endpoints/graph.ts'
import { mountLayoutRoutes } from './graph-endpoints/layout.ts'
import { mountSelectionRoutes } from './session-endpoints/selection.ts'
import { mountSessionStateRoutes } from './session-endpoints/sessionState.ts'
import { mountVaultRoutes } from './graph-endpoints/vault.ts'
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

export function mountDaemonRoutes(
  app: Hono,
  opts: CreateDaemonAppOptions,
): void {
  mountSessionRoutes(app, opts.registry)
  mountSessionEventsRoute(app, opts.registry)
  mountSessionStateRoutes(app, opts.registry)
  mountCollapseRoutes(app, opts.registry)
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
  mountVaultRoutes(app)
}

export function createDaemonApp(opts: CreateDaemonAppOptions): Hono {
  const app = new Hono()
  mountDaemonRoutes(app, opts)
  return app
}
