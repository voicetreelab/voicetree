import * as O from 'fp-ts/lib/Option.js'
import { Hono } from 'hono'
import { z } from 'zod'
import type { GraphDelta, GraphNode, NodeDelta } from '@vt/graph-model/graph'
import { GraphStateSchema } from '../contract.ts'
import { applyGraphDeltaToDBThroughMemAndUI } from '../graph/applyGraphDelta.ts'
import { getGraph, getNode } from '../state/graph-store.ts'
import { getProjectRootWatchedDirectory } from '../state/watch-folder-store.ts'
import { publish } from '../events/deltaEventBus.ts'
import { findFileByName } from '../graph/findFileByName.ts'
import { getPreviewContainedNodeIds } from '../context-nodes/getPreviewContainedNodeIds.ts'
import { performUndo, performRedo } from '../graph/undoOperations.ts'
import type { SessionRegistry } from '../session/registry.ts'

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

const ErrorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
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

function normalizeDelta(delta: readonly z.infer<typeof GraphDeltaRequestSchema>[number][]): GraphDelta {
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

function jsonError(
  c: {
    json: (body: unknown, status?: number) => Response
  },
  error: string,
  code: string,
  status = 400,
): Response {
  return c.json(ErrorResponseSchema.parse({ error, code }), status)
}

export function createGraphRoutes(_registry: SessionRegistry): Hono {
  const app = new Hono()

  app.get('/', (c) => {
    const body = GraphStateSchema.parse(getGraph())
    return c.json(body)
  })

  app.post('/delta', async (c) => {
    let delta: GraphDelta
    try {
      delta = normalizeDelta(GraphDeltaRequestSchema.parse(await c.req.json()))
    } catch {
      return jsonError(c, 'Invalid GraphDelta request body', 'INVALID_GRAPH_DELTA')
    }

    try {
      await applyGraphDeltaToDBThroughMemAndUI(delta)
      const sessionId = c.req.header('X-Session-Id') ?? 'anonymous'
      publish({ delta, source: `session:${sessionId}` })
      return c.json({ delta, graph: GraphStateSchema.parse(getGraph()) })
    } catch (error) {
      return jsonError(
        c,
        (error as Error).message,
        'GRAPH_DELTA_APPLY_FAILED',
        500,
      )
    }
  })

  app.delete('/node/:encodedNodeId', async (c) => {
    const nodeId = decodeURIComponent(c.req.param('encodedNodeId'))
    const existingNode = getNode(nodeId)
    if (!existingNode) {
      return jsonError(c, `Node not found: ${nodeId}`, 'NODE_NOT_FOUND', 404)
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
      return c.json({ delta, graph: GraphStateSchema.parse(getGraph()) })
    } catch (error) {
      return jsonError(
        c,
        (error as Error).message,
        'GRAPH_NODE_DELETE_FAILED',
        500,
      )
    }
  })

  app.get('/find-file', async (c) => {
    const name = c.req.query('name')
    if (!name) {
      return jsonError(c, 'Missing required query parameter: name', 'MISSING_NAME')
    }

    const searchPath = getProjectRootWatchedDirectory()
    if (!searchPath) {
      return jsonError(c, 'No vault is currently open', 'NO_VAULT', 503)
    }

    const matches = await findFileByName(name, searchPath)
    return c.json({ matches })
  })

  app.get('/preview-contained-nodes/:nodeId', async (c) => {
    const nodeId = decodeURIComponent(c.req.param('nodeId'))
    const nodeIds = await getPreviewContainedNodeIds(nodeId)
    return c.json({ nodeIds })
  })

  app.post('/undo', async (c) => {
    const applied = await performUndo()
    return c.json({ applied })
  })

  app.post('/redo', async (c) => {
    const applied = await performRedo()
    return c.json({ applied })
  })

  return app
}
