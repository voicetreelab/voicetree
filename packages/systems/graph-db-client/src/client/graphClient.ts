import {
  GraphStateSchema,
  type GraphState,
} from '../contract.ts'
import {
  FindFileMatchesResponseSchema,
  PreviewContainedNodeIdsResponseSchema,
  UndoRedoResponseSchema,
  UnknownResponseSchema,
  WriteMarkdownFileResponseSchema,
  WritePositionsResponseSchema,
} from '../responseSchemas.ts'
import type { RequestClient } from './requestCore.ts'

export type GraphClient = ReturnType<typeof createGraphClient>

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function serializeNodeForIpc(node: unknown): unknown {
  if (!isObject(node)) return node
  const meta = (node as { nodeUIMetadata?: unknown }).nodeUIMetadata
  if (!isObject(meta)) return node
  const props = (meta as { additionalYAMLProps?: unknown }).additionalYAMLProps
  if (!(props instanceof Map)) return node
  return {
    ...node,
    nodeUIMetadata: {
      ...meta,
      additionalYAMLProps: Array.from(props.entries()),
    },
  }
}

export function serializeDeltaForIpc(delta: unknown[]): unknown[] {
  return delta.map((entry) => {
    if (!isObject(entry)) return entry
    if (entry.type !== 'UpsertNode') return entry
    const nodeToUpsert = serializeNodeForIpc(entry.nodeToUpsert)
    const previousNode = entry.previousNode
    const serializedPrevious =
      isObject(previousNode) && previousNode._tag === 'Some'
        ? { ...previousNode, value: serializeNodeForIpc(previousNode.value) }
        : previousNode
    return { ...entry, nodeToUpsert, previousNode: serializedPrevious }
  })
}

export function createGraphClient(request: RequestClient) {
  return {
    async getGraph(): Promise<GraphState> {
      return await request('/graph', {
        responseSchema: GraphStateSchema,
      })
    },

    async postDelta(delta: unknown[], sessionId?: string): Promise<void> {
      const headers: Record<string, string> = {}
      if (sessionId) {
        headers['X-Session-Id'] = sessionId
      }

      await request('/graph/delta', {
        body: delta,
        expectNoContent: false,
        headers,
        method: 'POST',
        responseSchema: UnknownResponseSchema,
      })
    },

    async applyGraphDelta(
      delta: unknown[],
      opts: { recordForUndo?: boolean; sessionId?: string } = {},
    ): Promise<void> {
      const headers: Record<string, string> = {}
      if (opts.sessionId) {
        headers['X-Session-Id'] = opts.sessionId
      }

      await request('/graph/apply-delta', {
        body: {
          delta: serializeDeltaForIpc(delta),
          recordForUndo: opts.recordForUndo,
        },
        expectNoContent: false,
        headers,
        method: 'POST',
        responseSchema: UnknownResponseSchema,
      })
    },

    async writePositions(
      positions: Record<string, { x: number; y: number }>,
    ): Promise<{ written: number }> {
      return await request('/graph/write-positions', {
        body: { positions },
        method: 'POST',
        responseSchema: WritePositionsResponseSchema,
      })
    },

    async writeMarkdownFile(
      absolutePath: string,
      body: string,
      editorId: string,
    ): Promise<{ ok: true; absolutePath: string; preservedSuffix: string | null }> {
      return await request('/graph/write-markdown-file', {
        body: { absolutePath, body, editorId },
        method: 'POST',
        responseSchema: WriteMarkdownFileResponseSchema,
      })
    },

    async undo(): Promise<boolean> {
      return await request('/graph/undo', {
        method: 'POST',
        responseSchema: UndoRedoResponseSchema,
      })
    },

    async redo(): Promise<boolean> {
      return await request('/graph/redo', {
        method: 'POST',
        responseSchema: UndoRedoResponseSchema,
      })
    },

    async findFileByName(name: string): Promise<string[]> {
      return await request(
        `/graph/find-file?name=${encodeURIComponent(name)}`,
        { responseSchema: FindFileMatchesResponseSchema },
      )
    },

    async getPreviewContainedNodeIds(nodeId: string): Promise<readonly string[]> {
      return await request(
        `/graph/preview-contained-nodes/${encodeURIComponent(nodeId)}`,
        { responseSchema: PreviewContainedNodeIdsResponseSchema },
      )
    },
  }
}
