import { Hono } from 'hono'
import { z } from 'zod'
import {
  BuildIndexRequestSchema,
  SearchResponseSchema,
  FindFileResponseSchema,
} from '../contract.ts'
import { buildIndex, search } from '../search/index-backend.ts'
import { findFileByName } from '../graph/findFileByName.ts'
import { getProjectRootWatchedDirectory } from '../state/watch-folder-store.ts'

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

export function createSearchRoutes(): Hono {
  const app = new Hono()

  app.post('/build-index', async (c) => {
    let body: { vaultPath: string }
    try {
      body = BuildIndexRequestSchema.parse(await c.req.json())
    } catch {
      return jsonError(c, 'Invalid request body', 'INVALID_REQUEST_BODY')
    }
    try {
      await buildIndex(body.vaultPath)
      return c.json({ ok: true as const })
    } catch (error) {
      return jsonError(c, (error as Error).message, 'BUILD_INDEX_FAILED', 500)
    }
  })

  app.get('/file', async (c) => {
    const name = c.req.query('name')
    if (!name) {
      return jsonError(c, 'Missing required query param: name', 'MISSING_NAME_PARAM')
    }
    const searchPath = c.req.query('searchPath') ?? getProjectRootWatchedDirectory()
    if (!searchPath) {
      return jsonError(c, 'No search path provided and no project root set', 'NO_SEARCH_PATH', 400)
    }
    try {
      const files = await findFileByName(name, searchPath)
      return c.json(FindFileResponseSchema.parse({ files }))
    } catch (error) {
      return jsonError(c, (error as Error).message, 'FIND_FILE_FAILED', 500)
    }
  })

  app.get('/', async (c) => {
    const query = c.req.query('q')
    if (!query) {
      return jsonError(c, 'Missing required query param: q', 'MISSING_QUERY_PARAM')
    }
    const vaultPath = c.req.query('vaultPath') ?? getProjectRootWatchedDirectory()
    if (!vaultPath) {
      return jsonError(c, 'No vault path provided and no project root set', 'NO_VAULT_PATH', 400)
    }
    const topK = parseInt(c.req.query('topK') ?? '10', 10)
    try {
      const hits = await search(vaultPath, query, topK)
      return c.json(SearchResponseSchema.parse({ hits }))
    } catch (error) {
      return jsonError(c, (error as Error).message, 'SEARCH_FAILED', 500)
    }
  })

  return app
}
