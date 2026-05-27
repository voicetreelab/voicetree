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
  reconcileGraphWithDiskWorkflow,
  redoWorkflow,
  undoWorkflow,
  updateContextNodeContainedIdsWorkflow,
  writeMarkdownFileWorkflow,
  writePositionsWorkflow,
} from '@vt/graph-db-server/application/workflows/graph'
import type { WorkflowSessionRegistry } from '@vt/graph-db-server/application/workflows/sessionRoutes'
import { mountDaemonRoute, routeParam } from '../mountRouteSpec.ts'
import { daemonRouteSpecById, daemonRouteSpecBySignature } from '../routeSpecs.ts'
import { sendHttpResult } from '../httpResult.ts'

const GRAPH_PREFIX = '/graph'

export function createGraphRoutes(_registry: WorkflowSessionRegistry): Hono {
  const app = new Hono()

  mountDaemonRoute(
    app,
    daemonRouteSpecById('graph.read'),
    async (c) => sendHttpResult(c, await readGraphWorkflow()),
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecById('graph.delta'),
    async (c) => {
      return sendHttpResult(
        c,
        await applyGraphDeltaWorkflow(
          await c.req.json(),
          c.req.header('X-Session-Id') ?? 'anonymous',
        ),
      )
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature('POST', '/graph/apply-delta'),
    async (c) => {
      return sendHttpResult(
        c,
        await applyGraphDeltaWithOptionsWorkflow(
          await c.req.json(),
          c.req.header('X-Session-Id') ?? 'anonymous',
        ),
      )
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecById('graph.delete-node'),
    async (c) => {
      return sendHttpResult(
        c,
        await deleteGraphNodeWorkflow(
          decodeURIComponent(routeParam(c, 'encodedNodeId')),
          c.req.header('X-Session-Id') ?? 'anonymous',
        ),
      )
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature('POST', '/graph/reconcile-disk'),
    async (c) => sendHttpResult(c, await reconcileGraphWithDiskWorkflow()),
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature('GET', '/graph/find-file'),
    async (c) => {
      return sendHttpResult(c, await findFileWorkflow(c.req.query('name')))
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature(
      'GET',
      '/graph/preview-contained-nodes/:nodeId',
    ),
    async (c) => {
      return sendHttpResult(
        c,
        await previewContainedNodesWorkflow(
          decodeURIComponent(routeParam(c, 'nodeId')),
        ),
      )
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature('POST', '/graph/context-node'),
    async (c) => {
      return sendHttpResult(c, await createContextNodeWorkflow(await c.req.json()))
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature('POST', '/graph/context-node-from-question'),
    async (c) => {
      return sendHttpResult(
        c,
        await createContextNodeFromQuestionWorkflow(await c.req.json()),
      )
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature(
      'POST',
      '/graph/context-node-from-selected-nodes',
    ),
    async (c) => {
      return sendHttpResult(
        c,
        await createContextNodeFromSelectedNodesWorkflow(await c.req.json()),
      )
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature(
      'POST',
      '/graph/unseen-nodes-around-context-node',
    ),
    async (c) => {
      return sendHttpResult(
        c,
        await getUnseenNodesAroundContextNodeWorkflow(await c.req.json()),
      )
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature(
      'PATCH',
      '/graph/context-node-contained-ids',
    ),
    async (c) => {
      return sendHttpResult(
        c,
        await updateContextNodeContainedIdsWorkflow(await c.req.json()),
      )
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature('POST', '/graph/write-positions'),
    async (c) => {
      return sendHttpResult(c, await writePositionsWorkflow(await c.req.json()))
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature('POST', '/graph/write-markdown-file'),
    async (c) => {
      return sendHttpResult(c, await writeMarkdownFileWorkflow(await c.req.json()))
    },
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature('POST', '/graph/undo'),
    async (c) => sendHttpResult(c, await undoWorkflow()),
    { prefix: GRAPH_PREFIX },
  )

  mountDaemonRoute(
    app,
    daemonRouteSpecBySignature('POST', '/graph/redo'),
    async (c) => sendHttpResult(c, await redoWorkflow()),
    { prefix: GRAPH_PREFIX },
  )

  return app
}
