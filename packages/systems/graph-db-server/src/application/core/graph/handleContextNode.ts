import { z } from 'zod'
import type { Graph } from '@vt/graph-model/graph'
import { findFirstParentNode } from '@vt/graph-model/graph'
import { getNodeTitle } from '@vt/graph-model/markdown'
import { UnseenNodeSchema } from '@vt/graph-db-server/contract'

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

type InvalidRequestBody = {
  readonly ok: false
  readonly error: 'Invalid request body'
  readonly code: 'INVALID_REQUEST_BODY'
}

const invalidRequestBody: InvalidRequestBody = {
  ok: false,
  error: 'Invalid request body',
  code: 'INVALID_REQUEST_BODY',
}

export function parseContextNodeRequest(rawBody: unknown):
  | { readonly ok: true; readonly parentNodeId: string; readonly semanticNodeIds: string[] }
  | InvalidRequestBody {
  const parsed = ContextNodeRequestSchema.safeParse(rawBody)
  if (!parsed.success) return invalidRequestBody
  return {
    ok: true,
    parentNodeId: parsed.data.parentNodeId,
    semanticNodeIds: parsed.data.semanticNodeIds,
  }
}

export function parseContextNodeFromQuestionRequest(rawBody: unknown):
  | {
      readonly ok: true
      readonly nodeIds: string[]
      readonly question: string
      readonly semanticNodeIds: string[]
    }
  | InvalidRequestBody {
  const parsed = ContextNodeFromQuestionRequestSchema.safeParse(rawBody)
  if (!parsed.success) return invalidRequestBody
  return {
    ok: true,
    nodeIds: parsed.data.nodeIds,
    question: parsed.data.question,
    semanticNodeIds: parsed.data.semanticNodeIds,
  }
}

export function parseContextNodeFromSelectedNodesRequest(rawBody: unknown):
  | { readonly ok: true; readonly taskNodeId: string; readonly selectedNodeIds: string[] }
  | InvalidRequestBody {
  const parsed = ContextNodeFromSelectedNodesRequestSchema.safeParse(rawBody)
  if (!parsed.success) return invalidRequestBody
  return {
    ok: true,
    taskNodeId: parsed.data.taskNodeId,
    selectedNodeIds: parsed.data.selectedNodeIds,
  }
}

export function parseUnseenNodesAroundContextNodeRequest(rawBody: unknown):
  | {
      readonly ok: true
      readonly contextNodeId: string
      readonly searchFromNode?: string
    }
  | InvalidRequestBody {
  const parsed = UnseenNodesAroundContextNodeRequestSchema.safeParse(rawBody)
  if (!parsed.success) return invalidRequestBody
  return {
    ok: true,
    contextNodeId: parsed.data.contextNodeId,
    searchFromNode: parsed.data.searchFromNode,
  }
}

export function parseContextNodeContainedIdsRequest(rawBody: unknown):
  | { readonly ok: true; readonly contextNodeId: string; readonly newNodeIds: string[] }
  | InvalidRequestBody {
  const parsed = ContextNodeContainedIdsRequestSchema.safeParse(rawBody)
  if (!parsed.success) return invalidRequestBody
  return {
    ok: true,
    contextNodeId: parsed.data.contextNodeId,
    newNodeIds: parsed.data.newNodeIds,
  }
}

export function composeNodeIdResponse(nodeId: string): { readonly nodeId: string } {
  return { nodeId }
}

export function composeFromQuestionResponse(
  nodeId: string,
  graph: Graph,
): {
  readonly nodeId: string
  readonly title: string
  readonly parentNodePath: string
} {
  const contextNode = graph.nodes[nodeId]
  const parentNode = contextNode
    ? findFirstParentNode(contextNode, graph)
    : undefined

  return {
    nodeId,
    title: contextNode ? getNodeTitle(contextNode) : '',
    parentNodePath: parentNode?.absoluteFilePathIsID ?? '',
  }
}

export function composeUnseenNodesResponse(nodes: unknown): { readonly nodes: unknown } {
  return { nodes: z.array(UnseenNodeSchema).parse(nodes) }
}

export function composeContainedIdsUpdateResponse(): { readonly updated: true } {
  return { updated: true }
}
