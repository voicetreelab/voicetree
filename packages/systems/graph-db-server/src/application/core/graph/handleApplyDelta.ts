import * as O from 'fp-ts/lib/Option.js'
import { z } from 'zod'
import type { GraphDelta, GraphNode, NodeDelta } from '@vt/graph-model/graph'

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

const ApplyGraphDeltaRequestSchema = z.object({
  delta: GraphDeltaRequestSchema,
  recordForUndo: z.boolean().optional(),
})

export function normalizeAdditionalYAMLProps(
  value: unknown,
): ReadonlyMap<string, string> {
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

export function normalizeGraphNode(node: unknown): GraphNode {
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

export function normalizeDelta(
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

export function parseGraphDeltaRequest(rawBody: unknown):
  | { readonly ok: true; readonly delta: GraphDelta }
  | {
      readonly ok: false
      readonly error: 'Invalid GraphDelta request body'
      readonly code: 'INVALID_GRAPH_DELTA'
    } {
  const parsed = GraphDeltaRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid GraphDelta request body',
      code: 'INVALID_GRAPH_DELTA',
    }
  }

  return { ok: true, delta: normalizeDelta(parsed.data) }
}

export function parseApplyDeltaRequest(rawBody: unknown):
  | {
      readonly ok: true
      readonly delta: GraphDelta
      readonly recordForUndo?: boolean
    }
  | {
      readonly ok: false
      readonly error: 'Invalid apply-delta request body'
      readonly code: 'INVALID_APPLY_DELTA'
    } {
  const parsed = ApplyGraphDeltaRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid apply-delta request body',
      code: 'INVALID_APPLY_DELTA',
    }
  }

  return {
    ok: true,
    delta: normalizeDelta(parsed.data.delta),
    recordForUndo: parsed.data.recordForUndo,
  }
}

export function buildDeleteNodeDelta(
  nodeId: string,
  existingNode: GraphNode,
): GraphDelta {
  return [
    {
      type: 'DeleteNode',
      nodeId,
      deletedNode: O.some(existingNode),
    },
  ]
}
