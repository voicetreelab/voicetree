import * as O from 'fp-ts/lib/Option.js'
import { z } from 'zod'
import type { Graph, GraphDelta, GraphNode, NodeDelta } from '@vt/graph-model/graph'
import { findFirstParentNode } from '@vt/graph-model/graph'
import { getNodeTitle } from '@vt/graph-model/markdown'
import { GraphStateSchema, UnseenNodeSchema } from '@vt/graph-db-server/contract'
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
import { VaultNotOpenError, structuredVaultErrorResult } from '../errors/vaultNotOpen.ts'
import { errorResult, jsonResult, type HttpResult } from './httpResult.ts'

const GraphDeltaRequestSchema = z.array(
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('UpsertNode'),
      nodeToUpsert: z.unknown(),
      previousNode: z.unknown(),
    }),
    z.object({
      type: z.literal('DeleteNode'),
      nodeId: z.string(),
      deletedNode: z.unknown(),
    }),
  ]),
)

const ContextNodeRequestSchema = z.object({
  parentNodeId: z.string(),
  semanticNodeIds: z.array(z.string()),
})

const ContextNodeFromQuestionRequestSchema = z.object({
  nodeIds: z.array(z.string()),
  question: z.string(),
  semanticNodeIds: z.array(z.string()),
})

const ContextNodeFromSelectedNodesRequestSchema = z.object({
  taskNodeId: z.string(),
  selectedNodeIds: z.array(z.string()),
})

const UnseenNodesAroundContextNodeRequestSchema = z.object({
  contextNodeId: z.string(),
  searchFromNode: z.string().optional(),
})

const ContextNodeContainedIdsRequestSchema = z.object({
  contextNodeId: z.string(),
  newNodeIds: z.array(z.string()),
})

const ApplyGraphDeltaRequestSchema = z.object({
  delta: GraphDeltaRequestSchema,
  recordForUndo: z.boolean().optional(),
})

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const WritePositionsRequestSchema = z.object({
  positions: z.record(z.string(), PositionSchema),
})

function normalizeAdditionalYAMLProps(value: unknown): ReadonlyMap<string, string> {
  if (value instanceof Map) return value as ReadonlyMap<string, string>

  if (Array.isArray(value)) {
    return new Map(
      value
        .filter((entry): entry is readonly [string, unknown] =>
          Array.isArray(entry) && typeof entry[0] === 'string',
        )
        .map(([key, entryValue]) => [key, String(entryValue)]),
    )
  }

  if (typeof value === 'object' && value !== null) {
    return new Map(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        typeof entryValue === 'string' ? entryValue : JSON.stringify(entryValue),
      ]),
    )
  }

  return new Map()
}

function normalizeGraphNode(node: unknown): GraphNode {
  const candidate = node as GraphNode
  return {
    ...candidate,
    nodeUIMetadata: {
      ...candidate.nodeUIMetadata,
      additionalYAMLProps: normalizeAdditionalYAMLProps(
        candidate.nodeUIMetadata?.additionalYAMLProps,
      ),
    },
  }
}

function graphWithUpdatedPositions(
  graph: Graph,
  positions: z.infer<typeof WritePositionsRequestSchema>['positions'],
): { graph: Graph; written: number } {
  let written = 0
  const nodes: Record<string, GraphNode> = Object.entries(graph.nodes).reduce(
    (acc: Record<string, GraphNode>, [nodeId, node]: [string, GraphNode]) => {
      const position = positions[nodeId]
      if (!position) {
        return { ...acc, [nodeId]: node }
      }

      written += 1
      return {
        ...acc,
        [nodeId]: {
          ...node,
          nodeUIMetadata: {
            ...node.nodeUIMetadata,
            position: O.some(position),
          },
        },
      }
    },
    {},
  )

  return {
    graph: {
      ...graph,
      nodes,
    },
    written,
  }
}

function normalizeDelta(
  delta: readonly z.infer<typeof GraphDeltaRequestSchema>[number][],
): GraphDelta {
  return delta.map((nodeDelta): NodeDelta => {
    if (nodeDelta.type === 'DeleteNode') {
      return nodeDelta as NodeDelta
    }

    const previousNode = nodeDelta.previousNode as O.Option<GraphNode>
    return {
      ...nodeDelta,
      nodeToUpsert: normalizeGraphNode(nodeDelta.nodeToUpsert),
      previousNode: O.isSome(previousNode)
        ? O.some(normalizeGraphNode(previousNode.value))
        : O.none,
    }
  })
}

export function readGraphWorkflow(): HttpResult {
  return jsonResult(GraphStateSchema.parse(getGraph()))
}

export async function applyGraphDeltaWorkflow(
  rawBody: unknown,
  sessionId: string,
  options: { recordForUndo?: boolean } = {},
): Promise<HttpResult> {
  let delta: GraphDelta
  try {
    delta = normalizeDelta(GraphDeltaRequestSchema.parse(rawBody))
  } catch {
    return errorResult('Invalid GraphDelta request body', 'INVALID_GRAPH_DELTA')
  }

  try {
    await applyGraphDeltaToDBThroughMemAndUI(delta, options.recordForUndo ?? true)
    publish({ delta, source: `session:${sessionId}` })
    return jsonResult({ delta, graph: GraphStateSchema.parse(getGraph()) })
  } catch (error) {
    if (error instanceof VaultNotOpenError) {
      return structuredVaultErrorResult(error)
    }
    return errorResult((error as Error).message, 'GRAPH_DELTA_APPLY_FAILED', 500)
  }
}

export async function applyGraphDeltaWithOptionsWorkflow(
  rawBody: unknown,
  sessionId: string,
): Promise<HttpResult> {
  const body = ApplyGraphDeltaRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid apply-delta request body', 'INVALID_APPLY_DELTA')
  }

  return await applyGraphDeltaWorkflow(body.data.delta, sessionId, {
    recordForUndo: body.data.recordForUndo,
  })
}

export async function deleteGraphNodeWorkflow(nodeId: string): Promise<HttpResult> {
  const existingNode = getNode(nodeId)
  if (!existingNode) {
    return errorResult(`Node not found: ${nodeId}`, 'NODE_NOT_FOUND', 404)
  }

  const delta: GraphDelta = [
    {
      type: 'DeleteNode',
      nodeId,
      deletedNode: O.some(existingNode),
    },
  ]

  try {
    await applyGraphDeltaToDBThroughMemAndUI(delta)
    return jsonResult({ delta, graph: GraphStateSchema.parse(getGraph()) })
  } catch (error) {
    return errorResult((error as Error).message, 'GRAPH_NODE_DELETE_FAILED', 500)
  }
}

export async function findFileWorkflow(name: string | undefined): Promise<HttpResult> {
  if (!name) {
    return errorResult('Missing required query parameter: name', 'MISSING_NAME')
  }

  const searchPath = getProjectRootWatchedDirectory()
  if (!searchPath) {
    return structuredVaultErrorResult(new VaultNotOpenError())
  }

  const matches = await findFileByName(name, searchPath)
  return jsonResult({ matches })
}

export async function previewContainedNodesWorkflow(nodeId: string): Promise<HttpResult> {
  const nodeIds = await getPreviewContainedNodeIds(nodeId)
  return jsonResult({ nodeIds })
}

export async function createContextNodeWorkflow(rawBody: unknown): Promise<HttpResult> {
  const body = ContextNodeRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  try {
    const nodeId = await createContextNode(
      body.data.parentNodeId,
      body.data.semanticNodeIds,
    )
    return jsonResult({ nodeId })
  } catch (error) {
    return errorResult((error as Error).message, 'CONTEXT_NODE_CREATE_FAILED', 500)
  }
}

export async function createContextNodeFromQuestionWorkflow(
  rawBody: unknown,
): Promise<HttpResult> {
  const body = ContextNodeFromQuestionRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  try {
    const nodeId = await createContextNodeFromQuestion(
      body.data.nodeIds,
      body.data.question,
      body.data.semanticNodeIds,
    )
    const graph = getGraph()
    const contextNode = graph.nodes[nodeId]
    const parentNode = contextNode
      ? findFirstParentNode(contextNode, graph)
      : undefined

    return jsonResult({
      nodeId,
      title: contextNode ? getNodeTitle(contextNode) : '',
      parentNodePath: parentNode?.absoluteFilePathIsID ?? '',
    })
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
  const body = ContextNodeFromSelectedNodesRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  try {
    const nodeId = await createContextNodeFromSelectedNodes(
      body.data.taskNodeId,
      body.data.selectedNodeIds,
    )
    return jsonResult({ nodeId })
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
  const body = UnseenNodesAroundContextNodeRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  try {
    const nodes = await getUnseenNodesAroundContextNode(
      body.data.contextNodeId,
      body.data.searchFromNode,
    )
    return jsonResult({ nodes: z.array(UnseenNodeSchema).parse(nodes) })
  } catch (error) {
    return errorResult((error as Error).message, 'UNSEEN_NODES_LOOKUP_FAILED', 500)
  }
}

export async function updateContextNodeContainedIdsWorkflow(
  rawBody: unknown,
): Promise<HttpResult> {
  const body = ContextNodeContainedIdsRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  try {
    await updateContextNodeContainedIds(body.data.contextNodeId, body.data.newNodeIds)
    return jsonResult({ updated: true })
  } catch (error) {
    return errorResult(
      (error as Error).message,
      'CONTEXT_NODE_CONTAINED_IDS_UPDATE_FAILED',
      500,
    )
  }
}

export async function writePositionsWorkflow(rawBody: unknown): Promise<HttpResult> {
  const body = WritePositionsRequestSchema.safeParse(rawBody)
  if (!body.success) {
    return errorResult('Invalid request body', 'INVALID_REQUEST_BODY')
  }

  const projectRoot = getProjectRootWatchedDirectory()
  if (!projectRoot) {
    return structuredVaultErrorResult(new VaultNotOpenError())
  }

  try {
    const result = graphWithUpdatedPositions(getGraph(), body.data.positions)
    setGraph(result.graph)
    writeAllPositionsSync(result.graph, projectRoot)
    return jsonResult({ written: result.written })
  } catch (error) {
    return errorResult((error as Error).message, 'WRITE_POSITIONS_FAILED', 500)
  }
}

export async function undoWorkflow(): Promise<HttpResult> {
  return jsonResult({ applied: await performUndo() })
}

export async function redoWorkflow(): Promise<HttpResult> {
  return jsonResult({ applied: await performRedo() })
}
