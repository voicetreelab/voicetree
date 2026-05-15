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
import { runCommand } from '../core/runCommand.ts'
import { errorResult, jsonResult, type HttpResult } from './httpResult.ts'

export async function readGraphWorkflow(): Promise<HttpResult> {
  return jsonResult(composeGraphResponse(await runCommand({ type: 'ReadGraph' })))
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
    await runCommand({
      type: 'ApplyGraphDeltaToDB',
      delta: parsed.delta,
      recordForUndo: options.recordForUndo,
    })
    await runCommand({
      type: 'PublishDelta',
      delta: parsed.delta,
      source: `session:${sessionId}`,
    })
    const graph = await runCommand({ type: 'ReadGraph' })
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
  const existingNode = await runCommand({ type: 'ReadGraphNode', nodeId })
  if (!existingNode) {
    return errorResult(`Node not found: ${nodeId}`, 'NODE_NOT_FOUND', 404)
  }

  const delta = buildDeleteNodeDelta(nodeId, existingNode)

  try {
    await runCommand({ type: 'ApplyGraphDeltaToDB', delta })
    const graph = await runCommand({ type: 'ReadGraph' })
    return jsonResult(composeApplyDeltaResponse(delta, graph))
  } catch (error) {
    return errorResult((error as Error).message, 'GRAPH_NODE_DELETE_FAILED', 500)
  }
}

export async function findFileWorkflow(name: string | undefined): Promise<HttpResult> {
  const request = classifyFindFileRequest({
    name,
    searchPath: await runCommand({ type: 'GetWatchedDirectory' }),
  })
  if (request.kind === 'error') {
    return errorResult(request.message, request.code, request.status)
  }

  const matches = await runCommand({
    type: 'FindFileByName',
    name: request.name,
    searchPath: request.searchPath,
  })
  return jsonResult(composeFindFileResponse(matches))
}

export async function previewContainedNodesWorkflow(nodeId: string): Promise<HttpResult> {
  const nodeIds = await runCommand({
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
    const nodeId = await runCommand({
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
    const nodeId = await runCommand({
      type: 'CreateContextNodeFromQuestion',
      nodeIds: parsed.nodeIds,
      question: parsed.question,
      semanticNodeIds: parsed.semanticNodeIds,
    })
    const graph = await runCommand({ type: 'ReadGraph' })
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
    const nodeId = await runCommand({
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
    const nodes = await runCommand({
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
    await runCommand({
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

  const projectRoot = await runCommand({ type: 'GetWatchedDirectory' })
  if (!projectRoot) {
    return errorResult('No vault is currently open', 'NO_VAULT', 503)
  }

  try {
    const result = graphWithUpdatedPositions(
      await runCommand({ type: 'ReadGraph' }),
      parsed.positions,
    )
    await runCommand({ type: 'SetGraph', graph: result.graph })
    await runCommand({
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
    await runCommand({ type: 'PerformUndo' }),
  ))
}

export async function redoWorkflow(): Promise<HttpResult> {
  return jsonResult(composeAppliedResponse(
    await runCommand({ type: 'PerformRedo' }),
  ))
}
