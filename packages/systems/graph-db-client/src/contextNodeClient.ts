import {
  CreateContextNodeFromQuestionRequestSchema,
  CreateContextNodeFromSelectionRequestSchema,
  CreateContextNodeRequestSchema,
  CreateContextNodeResponseSchema,
  PreviewContainedNodeIdsResponseSchema,
  UnseenNodesResponseSchema,
  UpdateContainedIdsRequestSchema,
  type CreateContextNodeResponse,
  type PreviewContainedNodeIdsResponse,
  type UnseenNodesResponse,
} from '@vt/graph-db-server/contract'
import { makeRequest } from './requestHelper.ts'

export async function createContextNode(
  baseUrl: string,
  parentNodeId: string,
): Promise<CreateContextNodeResponse> {
  return makeRequest(baseUrl, '/context-nodes', {
    body: CreateContextNodeRequestSchema.parse({ parentNodeId }),
    method: 'POST',
    responseSchema: CreateContextNodeResponseSchema,
  })
}

export async function createContextNodeFromQuestion(
  baseUrl: string,
  relevantNodeIds: string[],
  question: string,
): Promise<CreateContextNodeResponse> {
  return makeRequest(baseUrl, '/context-nodes/from-question', {
    body: CreateContextNodeFromQuestionRequestSchema.parse({ relevantNodeIds, question }),
    method: 'POST',
    responseSchema: CreateContextNodeResponseSchema,
  })
}

export async function createContextNodeFromSelection(
  baseUrl: string,
  taskNodeId: string,
  selectedNodeIds: string[],
): Promise<CreateContextNodeResponse> {
  return makeRequest(baseUrl, '/context-nodes/from-selection', {
    body: CreateContextNodeFromSelectionRequestSchema.parse({ taskNodeId, selectedNodeIds }),
    method: 'POST',
    responseSchema: CreateContextNodeResponseSchema,
  })
}

export async function getUnseenNodesNearby(
  baseUrl: string,
  contextNodeId: string,
  searchFromNode?: string,
): Promise<UnseenNodesResponse> {
  const params = new URLSearchParams()
  if (searchFromNode) params.set('searchFromNode', encodeURIComponent(searchFromNode))
  const query = params.toString()
  const suffix = query ? `?${query}` : ''
  return makeRequest(
    baseUrl,
    `/context-nodes/${encodeURIComponent(contextNodeId)}/unseen-nearby${suffix}`,
    { responseSchema: UnseenNodesResponseSchema },
  )
}

export async function updateContextNodeContainedIds(
  baseUrl: string,
  contextNodeId: string,
  newNodeIds: string[],
): Promise<{ ok: true }> {
  return makeRequest(
    baseUrl,
    `/context-nodes/${encodeURIComponent(contextNodeId)}/contained-ids`,
    {
      body: UpdateContainedIdsRequestSchema.parse({ newNodeIds }),
      method: 'PATCH',
      responseSchema: { parse: (v: unknown) => v as { ok: true } },
    },
  )
}

export async function getPreviewContainedNodeIds(
  baseUrl: string,
  nodeId: string,
): Promise<PreviewContainedNodeIdsResponse> {
  return makeRequest(
    baseUrl,
    `/context-nodes/${encodeURIComponent(nodeId)}/preview-contained`,
    { responseSchema: PreviewContainedNodeIdsResponseSchema },
  )
}
