import {
  ExpandOverridesResponseSchema,
  ViewResponseSchema,
} from '@vt/graph-db-server/contract'
import {
  handleAddExpandOverride,
  handleDeleteExpandOverride,
  handleReadProjectedGraph,
  handleRenderView,
} from '../core/handleView.ts'
import { runCommand } from '../effects/runCommand.ts'
import { buildDaemonState } from '../session/buildDaemonState.ts'
import { jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

export async function renderSessionViewWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  budgetParam: string | undefined,
  expandParams: readonly string[],
): Promise<HttpResult> {
  const session = registry.getOrCreate(sessionId)
  const state = await buildDaemonState(session)
  const result = handleRenderView(session, state, budgetParam, expandParams)

  return jsonResult(ViewResponseSchema.parse(result.response))
}

export async function readProjectedGraphWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
): Promise<HttpResult> {
  const session = registry.getOrCreate(sessionId)
  const state = await buildDaemonState(session)
  const result = handleReadProjectedGraph(state)

  return jsonResult(result.response, 200)
}

export async function addExpandOverrideWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  folderId: string,
): Promise<HttpResult> {
  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  const result = handleAddExpandOverride(session, folderId)
  Object.assign(session, result.session)

  for (const command of result.commands) {
    await runCommand(command, { registry })
  }

  return jsonResult(ExpandOverridesResponseSchema.parse(result.response))
}

export async function deleteExpandOverrideWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  folderId: string,
): Promise<HttpResult> {
  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  const result = handleDeleteExpandOverride(session, folderId)
  Object.assign(session, result.session)

  for (const command of result.commands) {
    await runCommand(command, { registry })
  }

  return jsonResult(ExpandOverridesResponseSchema.parse(result.response))
}
