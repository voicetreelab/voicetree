import { Hono } from 'hono'
import { z } from 'zod'
import {
  CreateContextNodeRequestSchema,
  CreateContextNodeResponseSchema,
  CreateContextNodeFromQuestionRequestSchema,
  CreateContextNodeFromSelectionRequestSchema,
  UnseenNodesResponseSchema,
  UpdateContainedIdsRequestSchema,
  PreviewContainedNodeIdsResponseSchema,
} from '../contract.ts'
import { createContextNode } from '../context-nodes/createContextNode.ts'
import { createContextNodeFromQuestion } from '../context-nodes/createContextNodeFromQuestion.ts'
import { createContextNodeFromSelectedNodes } from '../context-nodes/createContextNodeFromSelectedNodes.ts'
import { getUnseenNodesAroundContextNode } from '../context-nodes/getUnseenNodesAroundContextNode.ts'
import { updateContextNodeContainedIds } from '../context-nodes/updateContextNodeContainedIds.ts'
import { getPreviewContainedNodeIds } from '../context-nodes/getPreviewContainedNodeIds.ts'

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
})

function jsonError(
  c: { json: (body: unknown, status?: number) => Response },
  error: string,
  code: string,
  status = 400,
): Response {
  return c.json(ErrorResponseSchema.parse({ error, code }), status)
}

export function createContextNodeRoutes(): Hono {
  const app = new Hono()

  app.post('/', async (c) => {
    let body: { parentNodeId: string }
    try {
      body = CreateContextNodeRequestSchema.parse(await c.req.json())
    } catch {
      return jsonError(c, 'Invalid request body', 'INVALID_REQUEST_BODY')
    }
    try {
      const contextNodeId = await createContextNode(body.parentNodeId)
      return c.json(CreateContextNodeResponseSchema.parse({ contextNodeId }))
    } catch (error) {
      return jsonError(c, (error as Error).message, 'CREATE_CONTEXT_NODE_FAILED', 500)
    }
  })

  app.post('/from-question', async (c) => {
    let body: { relevantNodeIds: string[]; question: string }
    try {
      body = CreateContextNodeFromQuestionRequestSchema.parse(await c.req.json())
    } catch {
      return jsonError(c, 'Invalid request body', 'INVALID_REQUEST_BODY')
    }
    try {
      const contextNodeId = await createContextNodeFromQuestion(body.relevantNodeIds, body.question)
      return c.json(CreateContextNodeResponseSchema.parse({ contextNodeId }))
    } catch (error) {
      return jsonError(c, (error as Error).message, 'CREATE_CONTEXT_NODE_FROM_QUESTION_FAILED', 500)
    }
  })

  app.post('/from-selection', async (c) => {
    let body: { taskNodeId: string; selectedNodeIds: string[] }
    try {
      body = CreateContextNodeFromSelectionRequestSchema.parse(await c.req.json())
    } catch {
      return jsonError(c, 'Invalid request body', 'INVALID_REQUEST_BODY')
    }
    try {
      const contextNodeId = await createContextNodeFromSelectedNodes(body.taskNodeId, body.selectedNodeIds)
      return c.json(CreateContextNodeResponseSchema.parse({ contextNodeId }))
    } catch (error) {
      return jsonError(c, (error as Error).message, 'CREATE_CONTEXT_NODE_FROM_SELECTION_FAILED', 500)
    }
  })

  app.get('/:encodedNodeId/unseen-nearby', async (c) => {
    const contextNodeId = decodeURIComponent(c.req.param('encodedNodeId'))
    const searchFromNodeRaw = c.req.query('searchFromNode')
    const searchFromNode = searchFromNodeRaw ? decodeURIComponent(searchFromNodeRaw) : undefined
    try {
      const nodes = await getUnseenNodesAroundContextNode(contextNodeId, searchFromNode)
      return c.json(UnseenNodesResponseSchema.parse({ nodes }))
    } catch (error) {
      return jsonError(c, (error as Error).message, 'GET_UNSEEN_NODES_FAILED', 500)
    }
  })

  app.patch('/:encodedNodeId/contained-ids', async (c) => {
    const contextNodeId = decodeURIComponent(c.req.param('encodedNodeId'))
    let body: { newNodeIds: string[] }
    try {
      body = UpdateContainedIdsRequestSchema.parse(await c.req.json())
    } catch {
      return jsonError(c, 'Invalid request body', 'INVALID_REQUEST_BODY')
    }
    try {
      await updateContextNodeContainedIds(contextNodeId, body.newNodeIds)
      return c.json({ ok: true as const })
    } catch (error) {
      return jsonError(c, (error as Error).message, 'UPDATE_CONTAINED_IDS_FAILED', 500)
    }
  })

  app.get('/:encodedNodeId/preview-contained', async (c) => {
    const nodeId = decodeURIComponent(c.req.param('encodedNodeId'))
    try {
      const nodeIds = await getPreviewContainedNodeIds(nodeId)
      return c.json(PreviewContainedNodeIdsResponseSchema.parse({ nodeIds }))
    } catch (error) {
      return jsonError(c, (error as Error).message, 'GET_PREVIEW_CONTAINED_FAILED', 500)
    }
  })

  return app
}
