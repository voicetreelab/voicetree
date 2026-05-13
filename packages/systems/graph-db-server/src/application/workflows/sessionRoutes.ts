import {
  SessionCreateResponseSchema,
  SessionInfoSchema,
} from '../../daemon/contract.ts'
import { type SessionRegistry } from '../session/registry.ts'
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
      collapseSetSize: session.collapseSet.size,
      selectionSize: session.selection.size,
    }),
  )
}
