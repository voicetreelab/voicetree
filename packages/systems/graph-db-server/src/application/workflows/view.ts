import { project } from '@vt/graph-state'
import { renderTreeCover } from '@vt/graph-tools/autoView'
import {
  ExpandOverridesResponseSchema,
  ViewResponseSchema,
} from '../../daemon/contract.ts'
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

  const budget = budgetParam ? Math.max(1, Math.trunc(Number(budgetParam))) : 30
  const mergedExpands = [...session.expandOverrides, ...expandParams]

  const state = await buildDaemonState(session)
  const graph = project(state)

  const output = renderTreeCover(graph, {
    collapsed: session.collapseSet,
    selected: session.selection,
    pinnedFolderIds: mergedExpands,
    budget,
  })

  return jsonResult(ViewResponseSchema.parse({ output, format: 'tree-cover' }))
}

export async function readProjectedGraphWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
): Promise<HttpResult> {
  const session = registry.getOrCreate(sessionId)
  const state = await buildDaemonState(session)
  return jsonResult(project(state), 200)
}

export function addExpandOverrideWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  folderId: string,
): HttpResult {
  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  session.expandOverrides.add(folderId)
  registry.touch(sessionId)
  return jsonResult(ExpandOverridesResponseSchema.parse({
    expandOverrides: [...session.expandOverrides],
  }))
}

export function deleteExpandOverrideWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  folderId: string,
): HttpResult {
  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  session.expandOverrides.delete(folderId)
  registry.touch(sessionId)
  return jsonResult(ExpandOverridesResponseSchema.parse({
    expandOverrides: [...session.expandOverrides],
  }))
}
