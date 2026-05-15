import {
  LayoutPartialSchema,
  LayoutResponseSchema,
  LiveStateSnapshotSchema,
  SelectionRequestSchema,
  SelectionResponseSchema,
  SessionCreateResponseSchema,
  SessionInfoSchema,
  ViewResponseSchema,
  type LayoutPartial,
  type LayoutResponse,
  type LiveStateSnapshot,
  type SelectionRequest,
  type SelectionResponse,
  type SessionInfo,
  type ViewResponse,
} from '../contract.ts'
import { UnknownResponseSchema } from '../responseSchemas.ts'
import type { RequestClient } from './requestCore.ts'

export type SessionClient = ReturnType<typeof createSessionClient>

export type GetSessionStateOptions = {
  readonly content?: 'full' | 'omit'
}

export function createSessionClient(request: RequestClient) {
  return {
    async createSession(): Promise<{ sessionId: string }> {
      return await request('/sessions', {
        method: 'POST',
        responseSchema: SessionCreateResponseSchema,
      })
    },

    async getSession(id: string): Promise<SessionInfo> {
      return await request(`/sessions/${encodeURIComponent(id)}`, {
        responseSchema: SessionInfoSchema,
      })
    },

    async deleteSession(id: string): Promise<void> {
      await request(`/sessions/${encodeURIComponent(id)}`, {
        expectNoContent: true,
        method: 'DELETE',
      })
    },

    async getSessionState(
      id: string,
      opts: GetSessionStateOptions = {},
    ): Promise<LiveStateSnapshot> {
      const contentQuery = opts.content === 'omit' ? '?content=omit' : ''
      return await request(`/sessions/${encodeURIComponent(id)}/state${contentQuery}`, {
        responseSchema: LiveStateSnapshotSchema,
      })
    },

    async collapse(
      sessionId: string,
      folderId: string,
    ): Promise<unknown> {
      return await request(
        `/sessions/${encodeURIComponent(sessionId)}/collapse/${encodeURIComponent(folderId)}`,
        {
          method: 'POST',
          responseSchema: UnknownResponseSchema,
        },
      )
    },

    async expand(
      sessionId: string,
      folderId: string,
    ): Promise<unknown> {
      return await request(
        `/sessions/${encodeURIComponent(sessionId)}/collapse/${encodeURIComponent(folderId)}`,
        {
          method: 'DELETE',
          responseSchema: UnknownResponseSchema,
        },
      )
    },

    async setSelection(
      sessionId: string,
      req: SelectionRequest,
    ): Promise<SelectionResponse> {
      return await request(
        `/sessions/${encodeURIComponent(sessionId)}/selection`,
        {
          body: SelectionRequestSchema.parse(req),
          method: 'POST',
          responseSchema: SelectionResponseSchema,
        },
      )
    },

    async getProjectedGraph(sessionId: string): Promise<unknown> {
      return await request(
        `/sessions/${encodeURIComponent(sessionId)}/projected-graph`,
        {
          responseSchema: UnknownResponseSchema,
        },
      )
    },

    async updateLayout(
      sessionId: string,
      partial: LayoutPartial,
    ): Promise<LayoutResponse> {
      return await request(
        `/sessions/${encodeURIComponent(sessionId)}/layout`,
        {
          body: LayoutPartialSchema.parse(partial),
          method: 'PUT',
          responseSchema: LayoutResponseSchema,
        },
      )
    },

    async getView(
      sessionId: string,
      opts?: { budget?: number; expand?: string[] },
    ): Promise<ViewResponse> {
      const params = new URLSearchParams()
      if (opts?.budget !== undefined) params.set('budget', String(opts.budget))
      for (const id of opts?.expand ?? []) params.append('expand', id)
      const query = params.toString()
      const suffix = query ? `?${query}` : ''
      return await request(
        `/sessions/${encodeURIComponent(sessionId)}/view${suffix}`,
        { responseSchema: ViewResponseSchema },
      )
    },
  }
}
