import {
  LayoutPartialSchema,
  LayoutResponseSchema,
} from '@vt/graph-db-server/contract'
import { errorResult, jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

export function updateLayoutWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  rawBody: unknown,
): HttpResult {
  const body = LayoutPartialSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  session.layout = {
    positions:
      body.data.positions === undefined
        ? session.layout.positions
        : {
            ...session.layout.positions,
            ...body.data.positions,
          },
    pan: body.data.pan ?? session.layout.pan,
    zoom: body.data.zoom ?? session.layout.zoom,
  }
  registry.touch(sessionId)

  return jsonResult(LayoutResponseSchema.parse({ layout: session.layout }))
}
