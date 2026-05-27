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
import { dispatch, dispatchOrCreateWithState } from './dispatch.ts'
import type { HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

export async function renderSessionViewWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  budgetParam: string | undefined,
  titleParam: string | undefined,
  expandParams: readonly string[],
): Promise<HttpResult> {
  return dispatchOrCreateWithState(
    registry,
    sessionId,
    { budgetParam, titleParam, expandParams },
    (session, state, input) => {
      const result = handleRenderView(
        session,
        state,
        input.budgetParam,
        input.titleParam,
        input.expandParams,
      )
      return {
        ...result,
        response: ViewResponseSchema.parse(result.response),
      }
    },
  )
}

export async function readProjectedGraphWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
): Promise<HttpResult> {
  return dispatchOrCreateWithState(
    registry,
    sessionId,
    undefined,
    (_session, state) => handleReadProjectedGraph(state),
  )
}

export async function addExpandOverrideWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  folderId: string,
): Promise<HttpResult> {
  return dispatch(registry, sessionId, folderId, (session, id) => {
    const result = handleAddExpandOverride(session, id)
    return {
      ...result,
      response: ExpandOverridesResponseSchema.parse(result.response),
    }
  })
}

export async function deleteExpandOverrideWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  folderId: string,
): Promise<HttpResult> {
  return dispatch(registry, sessionId, folderId, (session, id) => {
    const result = handleDeleteExpandOverride(session, id)
    return {
      ...result,
      response: ExpandOverridesResponseSchema.parse(result.response),
    }
  })
}
