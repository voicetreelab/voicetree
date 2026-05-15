import {
  SelectionRequestSchema,
  SelectionResponseSchema,
} from '@vt/graph-db-server/contract'
import { handleSelection } from '../core/handleSelection.ts'
import { runCommand } from '../effects/runCommand.ts'
import { errorResult, jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

export async function updateSelectionWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  rawBody: unknown,
): Promise<HttpResult> {
  const body = SelectionRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  const result = handleSelection(session, body.data.nodeIds, body.data.mode)
  Object.assign(session, result.session)

  for (const command of result.commands) {
    await runCommand(command, { registry })
  }

  return jsonResult(SelectionResponseSchema.parse(result.response))
}
