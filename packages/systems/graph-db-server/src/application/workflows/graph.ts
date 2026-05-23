import type { Graph, GraphDelta } from '@vt/graph-model/graph'
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
  parseWriteMarkdownFileRequest,
  parseWritePositionsRequest,
  writeMarkdownFileFromRequest,
} from '../core/graph/index.ts'
import { executeCommand } from './dispatch.ts'
import { VaultNotOpenError, structuredVaultErrorResult } from '../errors/vaultNotOpen.ts'
import { errorResult, jsonResult, type HttpResult } from './httpResult.ts'
import { traceGraphdSpan } from '@vt/graph-db-server/watch-folder/paths/traceGraphdSpan'

type WorkflowParsed = { readonly ok: true }

type WorkflowParseFailure = {
  readonly ok: false
  readonly error: string
  readonly code: string
  readonly status?: number
}

type WorkflowHalt = {
  readonly ok: false
  readonly result: HttpResult
}

type WorkflowRejected = WorkflowParseFailure | WorkflowHalt

type ParseOutcome<P extends WorkflowParsed> =
  | P
  | WorkflowRejected

type AnyParseOutcome = WorkflowParsed | WorkflowRejected

type MaybePromise<T> = T | Promise<T>

type ParsedOf<Outcome extends AnyParseOutcome> = Extract<Outcome, WorkflowParsed>

type WorkflowErrorResult = (error: unknown, errorCode: string) => HttpResult

type ApplyDeltaRequest = {
  readonly ok: true
  readonly delta: GraphDelta
}

type ApplyDeltaOptions = {
  readonly recordForUndo?: boolean
}

type DeleteGraphNodeRequest = {
  readonly ok: true
  readonly delta: GraphDelta
}

type WritePositionsRequest = Extract<
  ReturnType<typeof parseWritePositionsRequest>,
  WorkflowParsed
>

type WritePositionsInOpenVault = WritePositionsRequest & {
  readonly projectRoot: string
}

type WriteMarkdownFileRequest = Extract<
  Awaited<ReturnType<typeof parseWriteMarkdownFileRequest>>,
  WorkflowParsed
>

function parseRejectionResult(
  rejection: WorkflowRejected,
): HttpResult {
  if ('result' in rejection) return rejection.result
  return errorResult(rejection.error, rejection.code, rejection.status)
}

function workflowErrorResult(error: unknown, errorCode: string): HttpResult {
  return errorResult((error as Error).message, errorCode, 500)
}

function vaultAwareWorkflowErrorResult(
  error: unknown,
  errorCode: string,
): HttpResult {
  if (error instanceof VaultNotOpenError) {
    return structuredVaultErrorResult(error)
  }

  return workflowErrorResult(error, errorCode)
}

function vaultNotOpenResult(): WorkflowHalt {
  return {
    ok: false,
    result: structuredVaultErrorResult(new VaultNotOpenError()),
  }
}

function wrapWorkflow<Raw, Outcome extends AnyParseOutcome, R>(
  parse: (raw: Raw) => MaybePromise<Outcome>,
  exec: (parsed: ParsedOf<Outcome>) => Promise<R>,
  compose: (result: R, parsed: ParsedOf<Outcome>) => unknown,
  errorCode: string,
  toErrorResult: WorkflowErrorResult = workflowErrorResult,
): (raw: Raw) => Promise<HttpResult> {
  return async raw => {
    const parsed = await parse(raw)
    if (!parsed.ok) return parseRejectionResult(parsed)
    const parsedValue = parsed as ParsedOf<Outcome>

    try {
      return jsonResult(compose(await exec(parsedValue), parsedValue))
    } catch (error) {
      return toErrorResult(error, errorCode)
    }
  }
}

async function applyGraphDeltaAndReadGraph(
  parsed: ApplyDeltaRequest,
  sessionId: string,
  options: ApplyDeltaOptions,
): Promise<Graph> {
  await traceGraphdSpan('daemon.apply-delta.to-db', async span => {
    span.setAttribute('vt.delta.size', parsed.delta.length)
    await executeCommand({
      type: 'ApplyGraphDeltaToDB',
      delta: parsed.delta,
      recordForUndo: options.recordForUndo,
    })
  })
  await traceGraphdSpan('daemon.apply-delta.publish', async () => {
    await executeCommand({
      type: 'PublishDelta',
      delta: parsed.delta,
      source: `session:${sessionId}`,
    })
  })
  return await traceGraphdSpan('daemon.apply-delta.read-graph', async () =>
    await executeCommand({ type: 'ReadGraph' }),
  )
}

async function prepareDeleteGraphNode(
  nodeId: string,
): Promise<ParseOutcome<DeleteGraphNodeRequest>> {
  const existingNode = await executeCommand({ type: 'ReadGraphNode', nodeId })
  if (!existingNode) {
    return {
      ok: false,
      error: `Node not found: ${nodeId}`,
      code: 'NODE_NOT_FOUND',
      status: 404,
    }
  }

  return { ok: true, delta: buildDeleteNodeDelta(nodeId, existingNode) }
}

async function parseWritePositionsInOpenVault(
  rawBody: unknown,
): Promise<ParseOutcome<WritePositionsInOpenVault>> {
  const parsed = parseWritePositionsRequest(rawBody)
  if (!parsed.ok) return parsed

  const projectRoot = await executeCommand({ type: 'GetWatchedDirectory' })
  if (!projectRoot) return vaultNotOpenResult()

  return { ...parsed, projectRoot }
}

async function parseWriteMarkdownFileInOpenVault(
  rawBody: unknown,
): Promise<ParseOutcome<WriteMarkdownFileRequest>> {
  const projectRoot = await executeCommand({ type: 'GetWatchedDirectory' })
  if (!projectRoot) return vaultNotOpenResult()

  return await parseWriteMarkdownFileRequest(rawBody, projectRoot)
}

export async function readGraphWorkflow(): Promise<HttpResult> {
  return jsonResult(composeGraphResponse(await executeCommand({ type: 'ReadGraph' })))
}

async function tracedApplyDeltaAndCompose(
  delta: GraphDelta,
  sessionId: string,
  recordForUndo: boolean | undefined,
): Promise<HttpResult> {
  try {
    const graph = await applyGraphDeltaAndReadGraph(
      { ok: true, delta },
      sessionId,
      { recordForUndo },
    )
    const composed = await traceGraphdSpan(
      'daemon.apply-delta.compose-response',
      async span => {
        span.setAttribute('vt.graph.nodes', Object.keys((graph as { nodes?: object }).nodes ?? {}).length)
        return composeApplyDeltaResponse(delta, graph)
      },
    )
    return jsonResult(composed)
  } catch (error) {
    return vaultAwareWorkflowErrorResult(error, 'GRAPH_DELTA_APPLY_FAILED')
  }
}

export async function applyGraphDeltaWorkflow(
  rawBody: unknown,
  sessionId: string,
  options: { recordForUndo?: boolean } = {},
): Promise<HttpResult> {
  return await traceGraphdSpan('daemon.apply-delta', async span => {
    const parsed = parseGraphDeltaRequest(rawBody)
    if (!parsed.ok) return parseRejectionResult(parsed)
    span.setAttribute('vt.delta.size', parsed.delta.length)
    return await tracedApplyDeltaAndCompose(
      parsed.delta,
      sessionId,
      options.recordForUndo,
    )
  })
}

export async function applyGraphDeltaWithOptionsWorkflow(
  rawBody: unknown,
  sessionId: string,
): Promise<HttpResult> {
  return await traceGraphdSpan('daemon.apply-delta', async span => {
    const parsed = parseApplyDeltaRequest(rawBody)
    if (!parsed.ok) return parseRejectionResult(parsed)
    span.setAttribute('vt.delta.size', parsed.delta.length)
    return await tracedApplyDeltaAndCompose(
      parsed.delta,
      sessionId,
      parsed.recordForUndo,
    )
  })
}

export async function deleteGraphNodeWorkflow(nodeId: string): Promise<HttpResult> {
  return await wrapWorkflow(
    prepareDeleteGraphNode,
    async parsed => {
      await executeCommand({ type: 'ApplyGraphDeltaToDB', delta: parsed.delta })
      return await executeCommand({ type: 'ReadGraph' })
    },
    (graph, parsed) => composeApplyDeltaResponse(parsed.delta, graph),
    'GRAPH_NODE_DELETE_FAILED',
  )(nodeId)
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
  return await wrapWorkflow(
    parseContextNodeRequest,
    parsed => executeCommand({
      type: 'CreateContextNode',
      parentNodeId: parsed.parentNodeId,
      semanticNodeIds: parsed.semanticNodeIds,
    }),
    composeNodeIdResponse,
    'CONTEXT_NODE_CREATE_FAILED',
  )(rawBody)
}

export async function createContextNodeFromQuestionWorkflow(
  rawBody: unknown,
): Promise<HttpResult> {
  return await wrapWorkflow(
    parseContextNodeFromQuestionRequest,
    async parsed => {
      const nodeId = await executeCommand({
        type: 'CreateContextNodeFromQuestion',
        nodeIds: parsed.nodeIds,
        question: parsed.question,
        semanticNodeIds: parsed.semanticNodeIds,
      })
      const graph = await executeCommand({ type: 'ReadGraph' })
      return { nodeId, graph }
    },
    result => composeFromQuestionResponse(result.nodeId, result.graph),
    'QUESTION_CONTEXT_NODE_CREATE_FAILED',
  )(rawBody)
}

export async function createContextNodeFromSelectedNodesWorkflow(
  rawBody: unknown,
): Promise<HttpResult> {
  return await wrapWorkflow(
    parseContextNodeFromSelectedNodesRequest,
    parsed => executeCommand({
      type: 'CreateContextNodeFromSelectedNodes',
      taskNodeId: parsed.taskNodeId,
      selectedNodeIds: parsed.selectedNodeIds,
    }),
    composeNodeIdResponse,
    'SELECTED_CONTEXT_NODE_CREATE_FAILED',
  )(rawBody)
}

export async function getUnseenNodesAroundContextNodeWorkflow(
  rawBody: unknown,
): Promise<HttpResult> {
  return await wrapWorkflow(
    parseUnseenNodesAroundContextNodeRequest,
    parsed => executeCommand({
      type: 'GetUnseenNodesAroundContextNode',
      contextNodeId: parsed.contextNodeId,
      searchFromNode: parsed.searchFromNode,
    }),
    composeUnseenNodesResponse,
    'UNSEEN_NODES_LOOKUP_FAILED',
  )(rawBody)
}

export async function updateContextNodeContainedIdsWorkflow(
  rawBody: unknown,
): Promise<HttpResult> {
  return await wrapWorkflow(
    parseContextNodeContainedIdsRequest,
    async parsed => {
      await executeCommand({
        type: 'UpdateContextNodeContainedIds',
        contextNodeId: parsed.contextNodeId,
        newNodeIds: parsed.newNodeIds,
      })
    },
    () => composeContainedIdsUpdateResponse(),
    'CONTEXT_NODE_CONTAINED_IDS_UPDATE_FAILED',
  )(rawBody)
}

export async function writePositionsWorkflow(rawBody: unknown): Promise<HttpResult> {
  return await wrapWorkflow(
    parseWritePositionsInOpenVault,
    async parsed => {
      const result = graphWithUpdatedPositions(
        await executeCommand({ type: 'ReadGraph' }),
        parsed.positions,
      )
      await executeCommand({ type: 'SetGraph', graph: result.graph })
      await executeCommand({
        type: 'WriteAllPositions',
        graph: result.graph,
        projectRoot: parsed.projectRoot,
      })
      return result.written
    },
    written => ({ written }),
    'WRITE_POSITIONS_FAILED',
  )(rawBody)
}

export async function writeMarkdownFileWorkflow(rawBody: unknown): Promise<HttpResult> {
  return await wrapWorkflow(
    parseWriteMarkdownFileInOpenVault,
    writeMarkdownFileFromRequest,
    result => result,
    'WRITE_MARKDOWN_FILE_FAILED',
  )(rawBody)
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
