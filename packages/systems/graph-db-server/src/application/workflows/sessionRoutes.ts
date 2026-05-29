import {
  SessionCreateResponseSchema,
  SessionInfoSchema,
} from '@vt/graph-db-server/contract'
import { type SessionRegistry } from '../session/registry.ts'
import {
  isFolderVisibilityOpen,
  readCurrentFolderState,
} from '@vt/graph-db-server/views/folderVisibilityResource'
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

// Read the folder-state size through the SAME long-lived db handle + active-view
// resolution the folder-state PATCH writer uses (resource layer), rather than
// opening an independent fresh handle (`getFolderStateForActiveView`). A fresh
// handle re-runs `ensureDefaultView` and resolves the active view independently,
// which can resolve a DIFFERENT active view id than the writer's handle — so a
// session that has folder-state rows reads back as size 0. Sharing the writer's
// handle makes the size a faithful observation of what was written.
function readFolderStateSize(): number {
  if (!isFolderVisibilityOpen()) {
    return 0
  }
  return readCurrentFolderState().folderState.length
}
