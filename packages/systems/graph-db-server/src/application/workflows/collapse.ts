import { handleCollapse } from '../core/handleCollapse.ts'
import { dispatch } from './dispatch.ts'
import type { HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

export async function collapseSessionFolderWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  folderId: string,
  action: 'collapse' | 'expand',
): Promise<HttpResult> {
  return dispatch(
    registry,
    sessionId,
    { folderId, action },
    (session, input) => handleCollapse(session, input.folderId, input.action),
  )
}
