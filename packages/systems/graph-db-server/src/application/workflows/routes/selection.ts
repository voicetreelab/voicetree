import {
  SelectionRequestSchema,
  SelectionResponseSchema,
} from '@vt/graph-db-server/contract'
import { handleSelection } from '../../core/handleSelection.ts'
import { dispatch } from '../dispatch.ts'
import { errorResult, type HttpResult } from '../httpResult.ts'
import type { WorkflowSessionRegistry } from '../session/sessionRoutes.ts'

export async function updateSelectionWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  rawBody: unknown,
): Promise<HttpResult> {
  const body = SelectionRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  return dispatch(registry, sessionId, body.data, (session, selection) => {
    const result = handleSelection(session, selection.nodeIds, selection.mode)
    return {
      ...result,
      response: SelectionResponseSchema.parse(result.response),
    }
  })
}
