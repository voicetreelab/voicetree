import * as O from 'fp-ts/lib/Option.js'
import { z } from 'zod'
import type { Graph, GraphNode, Size } from '@vt/graph-model/graph'
import { isFolderLayoutKey } from '@vt/graph-db-server/state/graph-store'

// One persisted spatial-layout record: any of position (x,y) and/or size (w,h).
// This is the single renderer→daemon channel for ALL drag-driven spatial
// layout — node drags send {x,y}, folder resizes send {w,h}.
const NodeLayoutRecordSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
})

const WriteNodeLayoutRequestSchema = z.object({
  layout: z.record(z.string(), NodeLayoutRecordSchema),
})

export type NodeLayoutRecords = z.infer<
  typeof WriteNodeLayoutRequestSchema
>['layout']

export function parseWriteNodeLayoutRequest(rawBody: unknown):
  | { readonly ok: true; readonly layout: NodeLayoutRecords }
  | {
      readonly ok: false
      readonly error: 'Invalid request body'
      readonly code: 'INVALID_REQUEST_BODY'
    } {
  const parsed = WriteNodeLayoutRequestSchema.safeParse(rawBody)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid request body',
      code: 'INVALID_REQUEST_BODY',
    }
  }

  return { ok: true, layout: parsed.data.layout }
}

function hasPosition(record: NodeLayoutRecords[string]): boolean {
  return typeof record.x === 'number' && typeof record.y === 'number'
}

function hasSize(record: NodeLayoutRecords[string]): boolean {
  return typeof record.w === 'number' && typeof record.h === 'number'
}

/**
 * Extract folder-resize records (FolderId → Size) from an incoming layout
 * payload. Folder ids have no graph node, so their size is routed to the
 * folder-layout store rather than folded into the graph.
 */
export function folderSizesFromRecords(layout: NodeLayoutRecords): Map<string, Size> {
  const sizes = new Map<string, Size>()
  for (const [id, record] of Object.entries(layout)) {
    if (isFolderLayoutKey(id) && hasSize(record)) {
      sizes.set(id, { width: record.w as number, height: record.h as number })
    }
  }
  return sizes
}

/**
 * Fold incoming node-layout records into the graph's nodeUIMetadata. A record
 * may carry position, size, or both; each is applied independently so a
 * size-only write never clobbers an existing position and vice versa. Records
 * whose key matches no graph node (e.g. folder ids — see folderSizesFromRecords)
 * are ignored here. `written` counts graph nodes that received at least one
 * field.
 *
 * Single O(N) pass: unchanged nodes keep their original reference; only nodes
 * with a supplied record are rebuilt.
 */
export function graphWithUpdatedNodeLayout(
  graph: Graph,
  layout: NodeLayoutRecords,
): { graph: Graph; written: number } {
  let written = 0
  const nodes: Record<string, GraphNode> = {}
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    const record = layout[nodeId]
    if (!record || (!hasPosition(record) && !hasSize(record))) {
      nodes[nodeId] = node
      continue
    }

    written += 1
    nodes[nodeId] = {
      ...node,
      nodeUIMetadata: {
        ...node.nodeUIMetadata,
        ...(hasPosition(record) ? { position: O.some({ x: record.x as number, y: record.y as number }) } : {}),
        ...(hasSize(record) ? { size: O.some({ width: record.w as number, height: record.h as number }) } : {}),
      },
    }
  }

  return { graph: { ...graph, nodes }, written }
}
