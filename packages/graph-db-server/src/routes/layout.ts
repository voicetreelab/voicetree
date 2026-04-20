import type { Hono } from 'hono'
import {
  LayoutPartialSchema,
  LayoutResponseSchema,
  type LayoutPartial,
} from '../contract.ts'
import { SessionRegistry } from '../session/registry.ts'

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

function buildLayoutResponse(layout: {
  positions: Record<string, { x: number; y: number }>
  pan: { x: number; y: number }
  zoom: number
}) {
  return LayoutResponseSchema.parse({ layout })
}

export function mountLayoutRoutes(app: Hono, registry: SessionRegistry): void {
  app.put('/sessions/:sessionId/layout', async (c) => {
    let body: LayoutPartial
    try {
      body = LayoutPartialSchema.parse(await c.req.json())
    } catch {
      return jsonError(c, 'Invalid request body', 'INVALID_REQUEST_BODY')
    }

    const sessionId = c.req.param('sessionId')
    const session = registry.get(sessionId)
    if (!session) {
      return c.notFound()
    }

    session.layout = {
      positions:
        body.positions === undefined
          ? session.layout.positions
          : {
              ...session.layout.positions,
              ...body.positions,
            },
      pan: body.pan ?? session.layout.pan,
      zoom: body.zoom ?? session.layout.zoom,
    }
    registry.touch(sessionId)

    return c.json(buildLayoutResponse(session.layout))
  })
}
