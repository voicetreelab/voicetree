import {
  buildDeleteNodeDelta,
  composeApplyDeltaResponse,
  parseApplyDeltaRequest,
  parseGraphDeltaRequest,
  composeContainedIdsUpdateResponse,
  composeFromQuestionResponse,
  composeNodeIdResponse,
  composeUnseenNodesResponse,
  parseContextNodeContainedIdsRequest,
  parseContextNodeFromQuestionRequest,
  parseContextNodeFromSelectedNodesRequest,
  parseContextNodeRequest,
  parseUnseenNodesAroundContextNodeRequest,
  classifyFindFileRequest,
  composeAppliedResponse,
  composeFindFileResponse,
  composeGraphResponse,
  graphWithUpdatedPositions,
  parseWritePositionsRequest,
} from '../core/graph/index.ts'
import { executeCommand } from './dispatch.ts'
import { errorResult, jsonResult, type HttpResult } from './httpResult.ts'

export async function readGraphWorkflow(): Promise<HttpResult> {
  return jsonResult(composeGraphResponse(await executeCommand({ type: 'ReadGraph' })))
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
    await executeCommand({
      type: 'ApplyGraphDeltaToDB',
      delta: parsed.delta,
      recordForUndo: options.recordForUndo,
    })
    await executeCommand({
      type: 'PublishDelta',
      delta: parsed.delta,
      source: `session:${sessionId}`,
    })
    const graph = await executeCommand({ type: 'ReadGraph' })
    return jsonResult(composeApplyDeltaResponse(parsed.delta, graph))
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
  const existingNode = await executeCommand({ type: 'ReadGraphNode', nodeId })
  if (!existingNode) {
    return errorResult(`Node not found: ${nodeId}`, 'NODE_NOT_FOUND', 404)
  }

  const delta = buildDeleteNodeDelta(nodeId, existingNode)

  try {
    await executeCommand({ type: 'ApplyGraphDeltaToDB', delta })
    const graph = await executeCommand({ type: 'ReadGraph' })
    return jsonResult(composeApplyDeltaResponse(delta, graph))
  } catch (error) {
    return errorResult((error as Error).message, 'GRAPH_NODE_DELETE_FAILED', 500)
  }
}

export async function findFileWorkflow(name: string | undefined): Promise<HttpResult> {
  const request = classifyFindFileRequest({
    name,
    searchPath: await executeCommand({ type: 'GetWatchedDirectory' }),
  })
  if (request.kind === 'error') {
    return errorResult(request.message, request.code, request.status)
  }

  const matches = await executeCommand({
    type: 'FindFileByName',
    name: request.name,
    searchPath: request.searchPath,
  })
  return jsonResult(composeFindFileResponse(matches))
}

export async function previewContainedNodesWorkflow(nodeId: string): Promise<HttpResult> {
  const nodeIds = await executeCommand({
    type: 'GetPreviewContainedNodeIds',
    nodeId,
  })
  return jsonResult({ nodeIds })
}

export async function createContextNodeWorkflow(rawBody: unknown): Promise<HttpResult> {
  const parsed = parseContextNodeRequest(rawBody)
  if (!parsed.ok) {
    return errorResult(parsed.error, parsed.code)
  }

  try {
    const nodeId = await executeCommand({
      type: 'CreateContextNode',
      parentNodeId: parsed.parentNodeId,
      semanticNodeIds: parsed.semanticNodeIds,
    })
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
    const nodeId = await executeCommand({
      type: 'CreateContextNodeFromQuestion',
      nodeIds: parsed.nodeIds,
      question: parsed.question,
      semanticNodeIds: parsed.semanticNodeIds,
    })
    const graph = await executeCommand({ type: 'ReadGraph' })
    return jsonResult(composeFromQuestionResponse(nodeId, graph))
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
    const nodeId = await executeCommand({
      type: 'CreateContextNodeFromSelectedNodes',
      taskNodeId: parsed.taskNodeId,
      selectedNodeIds: parsed.selectedNodeIds,
    })
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
    const nodes = await executeCommand({
      type: 'GetUnseenNodesAroundContextNode',
      contextNodeId: parsed.contextNodeId,
      searchFromNode: parsed.searchFromNode,
    })
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
    await executeCommand({
      type: 'UpdateContextNodeContainedIds',
      contextNodeId: parsed.contextNodeId,
      newNodeIds: parsed.newNodeIds,
    })
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

  const projectRoot = await executeCommand({ type: 'GetWatchedDirectory' })
  if (!projectRoot) {
    return errorResult('No vault is currently open', 'NO_VAULT', 503)
  }

  try {
    const result = graphWithUpdatedPositions(
      await executeCommand({ type: 'ReadGraph' }),
      parsed.positions,
    )
    await executeCommand({ type: 'SetGraph', graph: result.graph })
    await executeCommand({
      type: 'WriteAllPositions',
      graph: result.graph,
      projectRoot,
    })
    return jsonResult({ written: result.written })
  } catch (error) {
    return errorResult((error as Error).message, 'WRITE_POSITIONS_FAILED', 500)
  }
}

export async function undoWorkflow(): Promise<HttpResult> {
  return jsonResult(composeAppliedResponse(
    await executeCommand({ type: 'PerformUndo' }),
  ))
}

export async function redoWorkflow(): Promise<HttpResult> {
  return jsonResult(composeAppliedResponse(
    await executeCommand({ type: 'PerformRedo' }),
  ))
}
