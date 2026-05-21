import * as O from 'fp-ts/lib/Option.js'
import { z } from 'zod'
import type { Graph, GraphNode } from '@vt/graph-model/graph'

const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
})

const WritePositionsRequestSchema = z.object({
  positions: z.record(z.string(), PositionSchema),
})

export type GraphNodePositions = z.infer<
  typeof WritePositionsRequestSchema
>['positions']

export function parseWritePositionsRequest(rawBody: unknown):
  | { readonly ok: true; readonly positions: GraphNodePositions }
  | {
      readonly ok: false
      readonly error: 'Invalid request body'
      readonly code: 'INVALID_REQUEST_BODY'
    } {
  const parsed = WritePositionsRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    }
  }

  return { ok: true, positions: parsed.data.positions }
}

export function graphWithUpdatedPositions(
  graph: Graph,
  positions: GraphNodePositions,
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
