import type { Hono } from 'hono'
import {
  ensureVaultWorkflowInitialized,
  readVaultWorkflow,
  setWriteFolderWorkflow,
} from '@vt/graph-db-server/application/workflows/vault/vault'
import {
  closeVaultWorkflow,
  isRequestValidationError,
  openVaultWorkflow,
  parseOpenVaultBody,
} from '@vt/graph-db-server/application/workflows/vault/vaultLifecycle'
import {
  StructuredVaultError,
  structuredVaultErrorResult,
} from '@vt/graph-db-server/application/errors/vaultNotOpen'
import { mountDaemonRoute } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'
import { sendHttpResult } from '../httpResult.ts'
import { errorResult, emptyResult } from '@vt/graph-db-server/application/workflows/httpResult'

export function mountVaultRoutes(app: Hono): void {
  ensureVaultWorkflowInitialized()

  // Same-backend-fn invariant: keep these daemon routes on the same
  // @vt/graph-model exports the IPC surface exposes via
  // webapp/src/shell/edge/main/api.ts:120-122.
  mountDaemonRoute(app, daemonRouteSpecById('vault.show'), async (c) => {
    return sendHttpResult(c, await readVaultWorkflow())
  })

  mountDaemonRoute(app, daemonRouteSpecById('vault.open'), async (c) => {
    try {
      return c.json(await openVaultWorkflow(parseOpenVaultBody(await c.req.json())))
    } catch (error) {
      if (error instanceof StructuredVaultError) {
        return sendHttpResult(c, structuredVaultErrorResult(error))
      }
      if (isRequestValidationError(error)) {
        return sendHttpResult(c, errorResult('Invalid request body', 'INVALID_REQUEST_BODY'))
      }
      throw error
    }
  })

  mountDaemonRoute(app, daemonRouteSpecById('vault.close'), async (c) => {
    await closeVaultWorkflow()
    return sendHttpResult(c, emptyResult(204))
  })

  mountDaemonRoute(app, daemonRouteSpecById('vault.set-write-path'), async (c) => {
    return sendHttpResult(c, await setWriteFolderWorkflow(await c.req.json()))
  })
}
