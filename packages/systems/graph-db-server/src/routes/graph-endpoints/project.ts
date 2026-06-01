import type { Hono } from 'hono'
import {
  readProjectWorkflow,
  setWriteFolderPathWorkflow,
} from '@vt/graph-db-server/application/workflows/project'
import {
  closeProjectWorkflow,
  isRequestValidationError,
  openProjectWorkflow,
  parseOpenProjectBody,
} from '@vt/graph-db-server/application/workflows/projectLifecycle'
import {
  StructuredProjectError,
  structuredProjectErrorResult,
} from '@vt/graph-db-server/application/errors/projectNotOpen'
import { mountDaemonRoute } from '../mountRouteSpec.ts'
import { daemonRouteSpecById } from '../routeSpecs.ts'
import { sendHttpResult } from '../httpResult.ts'
import { errorResult, emptyResult } from '@vt/graph-db-server/application/workflows/httpResult'

export function mountProjectRoutes(app: Hono): void {
  // Same-backend-fn invariant: keep these daemon routes on the same
  // @vt/graph-model exports the IPC surface exposes via
  // webapp/src/shell/edge/main/api.ts:120-122.
  mountDaemonRoute(app, daemonRouteSpecById('project.show'), async (c) => {
    return sendHttpResult(c, await readProjectWorkflow())
  })

  mountDaemonRoute(app, daemonRouteSpecById('project.open'), async (c) => {
    try {
      return c.json(await openProjectWorkflow(parseOpenProjectBody(await c.req.json())))
    } catch (error) {
      if (error instanceof StructuredProjectError) {
        return sendHttpResult(c, structuredProjectErrorResult(error))
      }
      if (isRequestValidationError(error)) {
        return sendHttpResult(c, errorResult('Invalid request body', 'INVALID_REQUEST_BODY'))
      }
      throw error
    }
  })

  mountDaemonRoute(app, daemonRouteSpecById('project.close'), async (c) => {
    await closeProjectWorkflow()
    return sendHttpResult(c, emptyResult(204))
  })

  mountDaemonRoute(app, daemonRouteSpecById('project.set-write-path'), async (c) => {
    return sendHttpResult(c, await setWriteFolderPathWorkflow(await c.req.json()))
  })
}
