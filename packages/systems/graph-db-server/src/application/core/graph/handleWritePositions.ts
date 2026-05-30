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
  // Build the next nodes record in a single O(N) pass. The previous
  // `reduce(..., { ...acc, [nodeId]: node })` spread the whole accumulator on
  // every iteration, making this O(N^2) in the node count for every position
  // write. Assigning into one fresh object is O(N) and preserves the exact
  // semantics: unchanged nodes keep their original reference, only nodes with
  // a supplied position are rebuilt, and `written` still counts graph nodes
  // that received a position.
  const nodes: Record<string, GraphNode> = {}
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    const position = positions[nodeId]
    if (!position) {
      nodes[nodeId] = node
      continue
    }

    written += 1
    nodes[nodeId] = {
      ...node,
      nodeUIMetadata: {
        ...node.nodeUIMetadata,
        position: O.some(position),
      },
    }
  }

  return {
    graph: {
      ...graph,
      nodes,
    },
    written,
  }
}
