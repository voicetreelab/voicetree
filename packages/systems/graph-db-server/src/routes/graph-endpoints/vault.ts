import type { Hono } from 'hono'
import {
  addReadPathWorkflow,
  ensureVaultWorkflowInitialized,
  readVaultWorkflow,
  removeReadPathWorkflow,
  setWritePathWorkflow,
} from '@vt/graph-db-server/application/workflows/vault'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'
import { sendHttpResult } from '../httpResult.ts'

export function mountVaultRoutes(app: Hono): void {
  ensureVaultWorkflowInitialized()

  // Same-backend-fn invariant: keep these daemon routes on the same
  // @vt/graph-model exports the IPC surface exposes via
  // webapp/src/shell/edge/main/api.ts:120-122.
  mountDaemonRoute(app, daemonRouteSpecById('vault.show'), async (c) => {
    return sendHttpResult(c, await readVaultWorkflow())
  })

  mountDaemonRoute(app, daemonRouteSpecById('vault.add-read-path'), async (c) => {
    return sendHttpResult(c, await addReadPathWorkflow(await c.req.json()))
  })

  mountDaemonRoute(app, daemonRouteSpecById('vault.remove-read-path'), async (c) => {
    return sendHttpResult(
      c,
      await removeReadPathWorkflow(routeParam(c, 'encodedPath')),
    )
  })

  mountDaemonRoute(app, daemonRouteSpecById('vault.set-write-path'), async (c) => {
    return sendHttpResult(c, await setWritePathWorkflow(await c.req.json()))
  })
}
