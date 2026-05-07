import { Hono } from 'hono'
import { z } from 'zod'
import {
  ProjectRootResponseSchema,
  SetProjectRootRequestSchema,
  WatchStatusResponseSchema,
} from '../contract.ts'
import {
  getProjectRootWatchedDirectory,
  setProjectRootWatchedDirectory,
} from '../state/watch-folder-store.ts'
import { getWatchStatus } from '../watch-folder/watchFolder.ts'

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
})

function jsonError(
  c: { json: (body: unknown, status?: number) => Response },
  error: string,
  code: string,
  status = 400,
): Response {
  return c.json(ErrorResponseSchema.parse({ error, code }), status)
}

export function createWatchRoutes(): Hono {
  const app = new Hono()

  app.get('/project-root', (c) => {
    const projectRoot = getProjectRootWatchedDirectory()
    return c.json(ProjectRootResponseSchema.parse({ projectRoot }))
  })

  app.put('/project-root', async (c) => {
    let body: { projectRoot: string }
    try {
      body = SetProjectRootRequestSchema.parse(await c.req.json())
    } catch {
      return jsonError(c, 'Invalid request body', 'INVALID_REQUEST_BODY')
    }
    try {
      setProjectRootWatchedDirectory(body.projectRoot)
      return c.json(ProjectRootResponseSchema.parse({ projectRoot: body.projectRoot }))
    } catch (error) {
      return jsonError(c, (error as Error).message, 'SET_PROJECT_ROOT_FAILED', 500)
    }
  })

  app.get('/status', (c) => {
    try {
      const status = getWatchStatus()
      return c.json(WatchStatusResponseSchema.parse(status))
    } catch (error) {
      return jsonError(c, (error as Error).message, 'GET_WATCH_STATUS_FAILED', 500)
    }
  })

  return app
}
