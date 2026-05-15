import { applyGraphDeltaToDBThroughMemAndUI } from '@vt/graph-db-server/graph/applyGraphDelta'
import { findFileByName } from '@vt/graph-db-server/graph/findFileByName'
import { getPreviewContainedNodeIds } from '@vt/graph-db-server/context-nodes/getPreviewContainedNodeIds'
import { performRedo, performUndo } from '@vt/graph-db-server/graph/undoOperations'
import { writeAllPositionsSync } from '@vt/graph-db-server/graph/writeAllPositionsOnExit'
import { createContextNode } from '@vt/graph-db-server/context-nodes/createContextNode'
import { createContextNodeFromQuestion } from '@vt/graph-db-server/context-nodes/createContextNodeFromQuestion'
import { createContextNodeFromSelectedNodes } from '@vt/graph-db-server/context-nodes/createContextNodeFromSelectedNodes'
import { getUnseenNodesAroundContextNode } from '@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode'
import { updateContextNodeContainedIds } from '@vt/graph-db-server/context-nodes/updateContextNodeContainedIds'
import { getGraph, getNode, setGraph } from '@vt/graph-db-server/state/graph-store'
import { publish } from '@vt/graph-db-server/state/events/deltaEventBus'
import { getProjectRootWatchedDirectory } from '@vt/graph-db-server/state/watch-folder-store'
import {
  buildDeleteNodeDelta,
  composeApplyDeltaResponse,
  parseApplyDeltaRequest,
  parseGraphDeltaRequest,
} from '../core/graph/handleApplyDelta.ts'
import {
  composeContainedIdsUpdateResponse,
  composeFromQuestionResponse,
  composeNodeIdResponse,
  composeUnseenNodesResponse,
  parseContextNodeContainedIdsRequest,
  parseContextNodeFromQuestionRequest,
  parseContextNodeFromSelectedNodesRequest,
  parseContextNodeRequest,
  parseUnseenNodesAroundContextNodeRequest,
} from '../core/graph/handleContextNode.ts'
import {
  classifyFindFileRequest,
  composeAppliedResponse,
  composeFindFileResponse,
  composeGraphResponse,
} from '../core/graph/handleReadGraph.ts'
import {
  graphWithUpdatedPositions,
  parseWritePositionsRequest,
} from '../core/graph/handleWritePositions.ts'
import { errorResult, jsonResult, type HttpResult } from './httpResult.ts'

export function readGraphWorkflow(): HttpResult {
  return jsonResult(composeGraphResponse(getGraph()))
}

export async function applyGraphDeltaWorkflow(
  rawBody: unknown,
  sessionId: string,
  options: { recordForUndo?: boolean } = {},
): Promise<HttpResult> {
  const parsed = parseGraphDeltaRequest(rawBody)
  if (!parsed.ok) {
    return errorResult(parsed.error, parsed.code)
  }

  try {
    await applyGraphDeltaToDBThroughMemAndUI(
      parsed.delta,
      options.recordForUndo ?? true,
    )
    publish({ delta: parsed.delta, source: `session:${sessionId}` })
    return jsonResult(composeApplyDeltaResponse(parsed.delta, getGraph()))
  } catch (error) {
    return errorResult((error as Error).message, 'GRAPH_DELTA_APPLY_FAILED', 500)
  }
}

export async function applyGraphDeltaWithOptionsWorkflow(
  rawBody: unknown,
  sessionId: string,
): Promise<HttpResult> {
  const parsed = parseApplyDeltaRequest(rawBody)
  if (!parsed.ok) {
    return errorResult(parsed.error, parsed.code)
  }

  return await applyGraphDeltaWorkflow(parsed.delta, sessionId, {
    recordForUndo: parsed.recordForUndo,
  })
}

export async function deleteGraphNodeWorkflow(nodeId: string): Promise<HttpResult> {
  const existingNode = getNode(nodeId)
  if (!existingNode) {
    return errorResult(`Node not found: ${nodeId}`, 'NODE_NOT_FOUND', 404)
  }

  const delta = buildDeleteNodeDelta(nodeId, existingNode)

  try {
    await applyGraphDeltaToDBThroughMemAndUI(delta)
    return jsonResult(composeApplyDeltaResponse(delta, getGraph()))
  } catch (error) {
    return errorResult((error as Error).message, 'GRAPH_NODE_DELETE_FAILED', 500)
  }
}

export async function findFileWorkflow(name: string | undefined): Promise<HttpResult> {
  const request = classifyFindFileRequest({
    name,
    searchPath: getProjectRootWatchedDirectory(),
  })
  if (request.kind === 'error') {
    return errorResult(request.message, request.code, request.status)
  }

  const matches = await findFileByName(request.name, request.searchPath)
  return jsonResult(composeFindFileResponse(matches))
}

export async function previewContainedNodesWorkflow(nodeId: string): Promise<HttpResult> {
  const nodeIds = await getPreviewContainedNodeIds(nodeId)
  return jsonResult({ nodeIds })
}

export async function createContextNodeWorkflow(rawBody: unknown): Promise<HttpResult> {
  const parsed = parseContextNodeRequest(rawBody)
  if (!parsed.ok) {
    return errorResult(parsed.error, parsed.code)
  }

  try {
    const nodeId = await createContextNode(
      parsed.parentNodeId,
      parsed.semanticNodeIds,
    )
    return jsonResult(composeNodeIdResponse(nodeId))
  } catch (error) {
    return errorResult((error as Error).message, 'CONTEXT_NODE_CREATE_FAILED', 500)
  }
}

export async function createContextNodeFromQuestionWorkflow(
  rawBody: unknown,
): Promise<HttpResult> {
  const parsed = parseContextNodeFromQuestionRequest(rawBody)
  if (!parsed.ok) {
    return errorResult(parsed.error, parsed.code)
  }

  try {
    const nodeId = await createContextNodeFromQuestion(
      parsed.nodeIds,
      parsed.question,
      parsed.semanticNodeIds,
    )
    return jsonResult(composeFromQuestionResponse(nodeId, getGraph()))
  } catch (error) {
    return errorResult(
      (error as Error).message,
      'QUESTION_CONTEXT_NODE_CREATE_FAILED',
      500,
    )
  }
}

export async function createContextNodeFromSelectedNodesWorkflow(
  rawBody: unknown,
): Promise<HttpResult> {
  const parsed = parseContextNodeFromSelectedNodesRequest(rawBody)
  if (!parsed.ok) {
    return errorResult(parsed.error, parsed.code)
  }

  try {
    const nodeId = await createContextNodeFromSelectedNodes(
      parsed.taskNodeId,
      parsed.selectedNodeIds,
    )
    return jsonResult(composeNodeIdResponse(nodeId))
  } catch (error) {
    return errorResult(
      (error as Error).message,
      'SELECTED_CONTEXT_NODE_CREATE_FAILED',
      500,
    )
  }
}

export async function getUnseenNodesAroundContextNodeWorkflow(
  rawBody: unknown,
): Promise<HttpResult> {
  const parsed = parseUnseenNodesAroundContextNodeRequest(rawBody)
  if (!parsed.ok) {
    return errorResult(parsed.error, parsed.code)
  }

  try {
    const nodes = await getUnseenNodesAroundContextNode(
      parsed.contextNodeId,
      parsed.searchFromNode,
    )
    return jsonResult(composeUnseenNodesResponse(nodes))
  } catch (error) {
    return errorResult((error as Error).message, 'UNSEEN_NODES_LOOKUP_FAILED', 500)
  }
}

export async function updateContextNodeContainedIdsWorkflow(
  rawBody: unknown,
): Promise<HttpResult> {
  const parsed = parseContextNodeContainedIdsRequest(rawBody)
  if (!parsed.ok) {
    return errorResult(parsed.error, parsed.code)
  }

  try {
    await updateContextNodeContainedIds(parsed.contextNodeId, parsed.newNodeIds)
    return jsonResult(composeContainedIdsUpdateResponse())
  } catch (error) {
    return errorResult(
      (error as Error).message,
      'CONTEXT_NODE_CONTAINED_IDS_UPDATE_FAILED',
      500,
    )
  }
}

export async function writePositionsWorkflow(rawBody: unknown): Promise<HttpResult> {
  const parsed = parseWritePositionsRequest(rawBody)
  if (!parsed.ok) {
    return errorResult(parsed.error, parsed.code)
  }

  const projectRoot = getProjectRootWatchedDirectory()
  if (!projectRoot) {
    return errorResult('No vault is currently open', 'NO_VAULT', 503)
  }

  try {
    const result = graphWithUpdatedPositions(getGraph(), parsed.positions)
    setGraph(result.graph)
    writeAllPositionsSync(result.graph, projectRoot)
    return jsonResult({ written: result.written })
  } catch (error) {
    return errorResult((error as Error).message, 'WRITE_POSITIONS_FAILED', 500)
  }
}

export async function undoWorkflow(): Promise<HttpResult> {
  return jsonResult(composeAppliedResponse(await performUndo()))
}

export async function redoWorkflow(): Promise<HttpResult> {
  return jsonResult(composeAppliedResponse(await performRedo()))
}
