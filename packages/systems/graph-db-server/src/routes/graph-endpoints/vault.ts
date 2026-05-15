import type { Hono } from 'hono'
import {
  addReadPathWorkflow,
  ensureVaultWorkflowInitialized,
  readVaultWorkflow,
  removeReadPathWorkflow,
  setWritePathWorkflow,
} from '@vt/graph-db-server/application/workflows/vault'
import {
  closeVaultWorkflow,
  isRequestValidationError,
  openVaultWorkflow,
  parseOpenVaultBody,
} from '@vt/graph-db-server/application/workflows/vaultLifecycle'
import {
  StructuredVaultError,
  structuredVaultErrorResult,
} from '../../application/errors/vaultNotOpen.ts'
import { sendHttpResult } from '../httpResult.ts'
import { errorResult, emptyResult } from '../../application/workflows/httpResult.ts'

export function mountVaultRoutes(app: Hono): void {
  ensureVaultWorkflowInitialized()

  // Same-backend-fn invariant: keep these daemon routes on the same
  // @vt/graph-model exports the IPC surface exposes via
  // webapp/src/shell/edge/main/api.ts:120-122.
  app.get('/vault', async (c) => {
    return sendHttpResult(c, await readVaultWorkflow())
  })

  app.post('/vault/open', async (c) => {
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

  app.post('/vault/close', async (c) => {
    await closeVaultWorkflow()
    return sendHttpResult(c, emptyResult(204))
  })

  app.post('/vault/read-paths', async (c) => {
    return sendHttpResult(c, await addReadPathWorkflow(await c.req.json()))
  })

  app.delete('/vault/read-paths/:encodedPath', async (c) => {
    return sendHttpResult(
      c,
      await removeReadPathWorkflow(c.req.param('encodedPath')),
    )
  })

  app.put('/vault/write-path', async (c) => {
    return sendHttpResult(c, await setWritePathWorkflow(await c.req.json()))
  })
}
