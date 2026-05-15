import {
  LayoutPartialSchema,
  LayoutResponseSchema,
} from '@vt/graph-db-server/contract'
import { handleLayout } from '../core/handleLayout.ts'
import { runCommand } from '../core/runCommand.ts'
import {
  errorResult,
  jsonResult,
  notFoundResult,
  type HttpResult,
} from './httpResult.ts'
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

  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  const result = handleLayout(session, body.data)
  Object.assign(session, result.session)

  for (const command of result.commands) {
    await runCommand(command, { registry })
  }

  return jsonResult(LayoutResponseSchema.parse(result.response))
}
