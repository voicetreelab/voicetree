import {
  SelectionRequestSchema,
  SelectionResponseSchema,
} from '@vt/graph-db-server/contract'
import { applySelection } from '../session/selection.ts'
import { errorResult, jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

export function updateSelectionWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  rawBody: unknown,
): HttpResult {
  const body = SelectionRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  session.selection = applySelection(session.selection, body.data.nodeIds, body.data.mode)
  registry.touch(sessionId)

  return jsonResult(
    SelectionResponseSchema.parse({
      selection: [...session.selection],
    }),
  )
}
