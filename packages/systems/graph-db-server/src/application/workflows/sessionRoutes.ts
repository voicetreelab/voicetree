import {
  SessionCreateResponseSchema,
  SessionInfoSchema,
} from '@vt/graph-db-server/contract'
import { type SessionRegistry } from '../session/registry.ts'
import { getProjectRoot } from '@vt/graph-db-server/state/watch-folder-store'
import { getFolderStateForActiveView } from '@vt/graph-db-server/views/folderStateOps'
import { emptyResult, jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'

export type WorkflowSessionRegistry = SessionRegistry

export function createSessionWorkflow(registry: WorkflowSessionRegistry): HttpResult {
  const session = registry.create()
  return jsonResult(SessionCreateResponseSchema.parse({ sessionId: session.id }), 201)
}

export function deleteSessionWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
): HttpResult {
  return registry.delete(sessionId) ? emptyResult(204) : notFoundResult()
}

export function readSessionWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
): HttpResult {
  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  return jsonResult(
    SessionInfoSchema.parse({
      id: session.id,
      lastAccessedAt: session.lastAccessedAt,
      folderStateSize: readFolderStateSize(),
      selectionSize: session.selection.size,
    }),
  )
}

function readFolderStateSize(): number {
  const projectRoot = getProjectRoot()
  if (!projectRoot) {
    return 0
  }
  try {
    return getFolderStateForActiveView(projectRoot).folderState.length
  } catch {
    return 0
  }
}
