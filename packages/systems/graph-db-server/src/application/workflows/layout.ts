import {
  LayoutPartialSchema,
  LayoutResponseSchema,
} from '@vt/graph-db-server/contract'
import { handleLayout } from '../core/handleLayout.ts'
import { dispatch } from './dispatch.ts'
import { errorResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

export async function updateLayoutWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  rawBody: unknown,
): Promise<HttpResult> {
  const body = LayoutPartialSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  return dispatch(registry, sessionId, body.data, (session, update) => {
    const result = handleLayout(session, update)
    return {
      ...result,
      response: LayoutResponseSchema.parse(result.response),
    }
  })
}
