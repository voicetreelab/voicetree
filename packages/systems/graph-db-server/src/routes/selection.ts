import type { Hono } from 'hono'
import {
  SelectionRequestSchema,
  SelectionResponseSchema,
  type SelectionRequest,
} from '../contract.ts'
import { SessionRegistry } from '../session/registry.ts'
import { applySelection } from '../session/selection.ts'

function jsonError(
  c: {
    json: (body: unknown, status?: number) => Response
  },
  error: string,
  code: string,
  status = 400,
): Response {
  return c.json({ error, code }, status)
}

function buildSelectionResponse(selection: Set<string>) {
  return SelectionResponseSchema.parse({
    selection: [...selection],
  })
}

export function mountSelectionRoutes(
  app: Hono,
  registry: SessionRegistry,
): void {
  app.post('/sessions/:sessionId/selection', async (c) => {
    let body: SelectionRequest
    try {
      body = SelectionRequestSchema.parse(await c.req.json())
    } catch {
      return jsonError(c, 'Invalid request body', 'INVALID_REQUEST_BODY')
    }

    const sessionId = c.req.param('sessionId')
    const session = registry.get(sessionId)
    if (!session) {
      return c.notFound()
    }

    session.selection = applySelection(session.selection, body.nodeIds, body.mode)
    registry.touch(sessionId)

    return c.json(buildSelectionResponse(session.selection))
  })
}
