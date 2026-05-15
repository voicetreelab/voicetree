import type { UnseenNode } from '../contract.ts'
import {
  ContextNodeFromQuestionResponseSchema,
  ContextNodeResponseSchema,
  UnseenNodesResponseSchema,
  UpdateContextNodeContainedIdsResponseSchema,
} from '../responseSchemas.ts'
import type { RequestClient } from './requestCore.ts'

export type ContextNodeClient = ReturnType<typeof createContextNodeClient>

export function createContextNodeClient(request: RequestClient) {
  return {
    async createContextNode(
      parentNodeId: string,
      semanticNodeIds: string[],
    ): Promise<{ nodeId: string }> {
      return await request('/graph/context-node', {
        body: { parentNodeId, semanticNodeIds },
        method: 'POST',
        responseSchema: ContextNodeResponseSchema,
      })
    },

    async createContextNodeFromQuestion(
      nodeIds: string[],
      question: string,
      semanticNodeIds: string[],
    ): Promise<{ nodeId: string; parentNodePath: string; title: string }> {
      return await request('/graph/context-node-from-question', {
        body: { nodeIds, question, semanticNodeIds },
        method: 'POST',
        responseSchema: ContextNodeFromQuestionResponseSchema,
      })
    },

    async createContextNodeFromSelectedNodes(
      taskNodeId: string,
      selectedNodeIds: readonly string[],
    ): Promise<{ nodeId: string }> {
      return await request('/graph/context-node-from-selected-nodes', {
        body: { taskNodeId, selectedNodeIds },
        method: 'POST',
        responseSchema: ContextNodeResponseSchema,
      })
    },

    async getUnseenNodesAroundContextNode(
      contextNodeId: string,
      searchFromNode?: string,
    ): Promise<readonly UnseenNode[]> {
      const result = await request('/graph/unseen-nodes-around-context-node', {
        body: { contextNodeId, searchFromNode },
        method: 'POST',
        responseSchema: UnseenNodesResponseSchema,
      })
      return result.nodes
    },

    async updateContextNodeContainedIds(
      contextNodeId: string,
      newNodeIds: readonly string[],
    ): Promise<void> {
      await request('/graph/context-node-contained-ids', {
        body: { contextNodeId, newNodeIds },
        method: 'PATCH',
        responseSchema: UpdateContextNodeContainedIdsResponseSchema,
      })
    },
  }
}
