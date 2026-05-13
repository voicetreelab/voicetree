import type { Hono } from 'hono'
import {
  addReadPathWorkflow,
  ensureVaultWorkflowInitialized,
  readVaultWorkflow,
  removeReadPathWorkflow,
  setWritePathWorkflow,
} from '../../application/workflows/vault.ts'
import { sendHttpResult } from '../httpResult.ts'

export function mountVaultRoutes(app: Hono): void {
  ensureVaultWorkflowInitialized()

  // Same-backend-fn invariant: keep these daemon routes on the same
  // @vt/graph-model exports the IPC surface exposes via
  // webapp/src/shell/edge/main/api.ts:120-122.
  app.get('/vault', async (c) => {
    return sendHttpResult(c, await readVaultWorkflow())
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
