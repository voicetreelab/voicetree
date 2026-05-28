import {
  GraphStateSchema,
  type GraphState,
} from '../contract.ts'
import {
  FindFileMatchesResponseSchema,
  GraphDiskReconciliationResponseSchema,
  PreviewContainedNodeIdsResponseSchema,
  UndoRedoResponseSchema,
  UnknownResponseSchema,
  WriteMarkdownFileResponseSchema,
  WritePositionsResponseSchema,
} from '../responseSchemas.ts'
import type { RequestClient } from './requestCore.ts'

export type GraphClient = ReturnType<typeof createGraphClient>

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
          delta,
          recordForUndo: opts.recordForUndo,
        },
        expectNoContent: false,
        headers,
        method: 'POST',
        responseSchema: UnknownResponseSchema,
      })
    },

    async reconcileGraphWithDisk(): Promise<unknown[]> {
      const response = await request('/graph/reconcile-disk', {
        method: 'POST',
        responseSchema: GraphDiskReconciliationResponseSchema,
      })
      return response.delta
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
