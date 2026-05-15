import { Hono } from 'hono'
import {
  applyGraphDeltaWithOptionsWorkflow,
  applyGraphDeltaWorkflow,
  createContextNodeFromSelectedNodesWorkflow,
  createContextNodeFromQuestionWorkflow,
  createContextNodeWorkflow,
  deleteGraphNodeWorkflow,
  findFileWorkflow,
  getUnseenNodesAroundContextNodeWorkflow,
  previewContainedNodesWorkflow,
  readGraphWorkflow,
  redoWorkflow,
  undoWorkflow,
  updateContextNodeContainedIdsWorkflow,
  writePositionsWorkflow,
} from '../../application/workflows/graph.ts'
import type { WorkflowSessionRegistry } from '../../application/workflows/sessionRoutes.ts'
import { sendHttpResult } from '../httpResult.ts'

export function createGraphRoutes(_registry: WorkflowSessionRegistry): Hono {
  const app = new Hono()

  app.get('/', (c) => sendHttpResult(c, readGraphWorkflow()))

  app.post('/delta', async (c) => {
    return sendHttpResult(
      c,
      await applyGraphDeltaWorkflow(
        await c.req.json(),
        c.req.header('X-Session-Id') ?? 'anonymous',
      ),
    )
  })

  app.post('/apply-delta', async (c) => {
    return sendHttpResult(
      c,
      await applyGraphDeltaWithOptionsWorkflow(
        await c.req.json(),
        c.req.header('X-Session-Id') ?? 'anonymous',
      ),
    )
  })

  app.delete('/node/:encodedNodeId', async (c) => {
    return sendHttpResult(
      c,
      await deleteGraphNodeWorkflow(
        decodeURIComponent(c.req.param('encodedNodeId')),
      ),
    )
  })

  app.get('/find-file', async (c) => {
    return sendHttpResult(c, await findFileWorkflow(c.req.query('name')))
  })

  app.get('/preview-contained-nodes/:nodeId', async (c) => {
    return sendHttpResult(
      c,
      await previewContainedNodesWorkflow(decodeURIComponent(c.req.param('nodeId'))),
    )
  })

  app.post('/context-node', async (c) => {
    return sendHttpResult(c, await createContextNodeWorkflow(await c.req.json()))
  })

  app.post('/context-node-from-question', async (c) => {
    return sendHttpResult(
      c,
      await createContextNodeFromQuestionWorkflow(await c.req.json()),
    )
  })

  app.post('/context-node-from-selected-nodes', async (c) => {
    return sendHttpResult(
      c,
      await createContextNodeFromSelectedNodesWorkflow(await c.req.json()),
    )
  })

  app.post('/unseen-nodes-around-context-node', async (c) => {
    return sendHttpResult(
      c,
      await getUnseenNodesAroundContextNodeWorkflow(await c.req.json()),
    )
  })

  app.patch('/context-node-contained-ids', async (c) => {
    return sendHttpResult(
      c,
      await updateContextNodeContainedIdsWorkflow(await c.req.json()),
    )
  })

  app.post('/write-positions', async (c) => {
    return sendHttpResult(c, await writePositionsWorkflow(await c.req.json()))
  })

  app.post('/undo', async (c) => sendHttpResult(c, await undoWorkflow()))

  app.post('/redo', async (c) => sendHttpResult(c, await redoWorkflow()))

  return app
}
