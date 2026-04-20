import { Hono } from 'hono'
import {
  HealthResponseSchema,
  ShutdownResponseSchema,
  type HealthResponse,
} from './contract.ts'
import { mountCollapseRoutes } from './routes/collapse.ts'
import { createGraphRoutes } from './routes/graph.ts'
import { mountLayoutRoutes } from './routes/layout.ts'
import { mountSelectionRoutes } from './routes/selection.ts'
import { mountSessionStateRoutes } from './routes/sessionState.ts'
import { mountVaultRoutes } from './routes/vault.ts'
import { mountSessionRoutes } from './routes/sessions.ts'
import { type SessionRegistry } from './session/registry.ts'

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
  mountSessionStateRoutes(app, opts.registry)
  mountCollapseRoutes(app, opts.registry)
  mountSelectionRoutes(app, opts.registry)
  mountLayoutRoutes(app, opts.registry)

  app.get('/health', (c) => {
    return c.json(HealthResponseSchema.parse(opts.readHealth()))
  })

  app.post('/shutdown', (c) => {
    opts.onShutdown()
    return c.json(ShutdownResponseSchema.parse({ ok: true }))
  })

  app.route('/graph', createGraphRoutes())
  mountVaultRoutes(app)
}

export function createDaemonApp(opts: CreateDaemonAppOptions): Hono {
  const app = new Hono()
  mountDaemonRoutes(app, opts)
  return app
}
