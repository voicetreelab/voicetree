import { handleCollapse } from '../core/handleCollapse.ts'
import { runCommand } from '../core/runCommand.ts'
import { jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

export async function collapseSessionFolderWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  folderId: string,
  action: 'collapse' | 'expand',
): Promise<HttpResult> {
  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  const result = handleCollapse(session, folderId, action)
  Object.assign(session, result.session)

  for (const command of result.commands) {
    await runCommand(command, { registry })
  }
  return jsonResult(result.response)
}
