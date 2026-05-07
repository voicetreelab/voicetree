import {
  AddReadPathRequestSchema,
  GraphStateSchema,
  HealthResponseSchema,
  LayoutPartialSchema,
  LayoutResponseSchema,
  LiveStateSnapshotSchema,
  LoadAndMergeRequestSchema,
  LoadAndMergeResponseSchema,
  RedoResponseSchema,
  SelectionRequestSchema,
  SelectionResponseSchema,
  SessionCreateResponseSchema,
  SessionInfoSchema,
  SetWritePathRequestSchema,
  ShutdownResponseSchema,
  UndoResponseSchema,
  VaultStateSchema,
  ViewResponseSchema,
  WritePositionsResponseSchema,
  type GraphState,
  type HealthResponse,
  type LayoutPartial,
  type LayoutResponse,
  type LiveStateSnapshot,
  type LoadAndMergeResponse,
  type RedoResponse,
  type SelectionRequest,
  type SelectionResponse,
  type SessionInfo,
  type ShutdownResponse,
  type UndoResponse,
  type VaultState,
  type ViewResponse,
  type WritePositionsResponse,
} from '@vt/graph-db-server/contract'
import { DaemonUnreachableError, GraphDbClientError } from './errors.ts'
import { discoverPort } from './portDiscovery.ts'
import { makeRequest } from './requestHelper.ts'
import type { RequestOpts } from './requestHelper.ts'

const ReadPathsMutationResponseSchema: { parse(input: unknown): { readPaths: string[] } } = {
  parse(input: unknown) {
    if (typeof input !== 'object' || input === null || !Array.isArray((input as Record<string, unknown>).readPaths)) {
      throw new Error('Invalid read-paths response body')
    }
    const r = input as { readPaths: unknown[] }
    if (!r.readPaths.every((value) => typeof value === 'string')) {
      throw new Error('Invalid read-paths response body')
    }
    return { readPaths: [...(r.readPaths as string[])] }
  },
}

const WritePathMutationResponseSchema: { parse(input: unknown): { writePath: string } } = {
  parse(input: unknown) {
    if (typeof input !== 'object' || input === null || typeof (input as Record<string, unknown>).writePath !== 'string') {
      throw new Error('Invalid write-path response body')
    }
    return { writePath: (input as { writePath: string }).writePath }
  },
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

export class GraphDbClient {
  public readonly baseUrl: string
  public readonly sessionId?: string

  constructor(opts: { baseUrl: string; sessionId?: string }) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl)
    this.sessionId = opts.sessionId
  }

  static async connect(opts: {
    vault: string
    sessionId?: string
  }): Promise<GraphDbClient> {
    const port = await discoverPort(opts.vault)
    const client = new GraphDbClient({
      baseUrl: `http://127.0.0.1:${port}`,
      sessionId: opts.sessionId,
    })

    try {
      await client.health()
    } catch (error) {
      if (error instanceof GraphDbClientError) {
        throw error
      }
      throw new DaemonUnreachableError(
        `Discovered vt-graphd for vault ${opts.vault}, but /health was unreachable`,
      )
    }

    return client
  }

  async health(): Promise<HealthResponse> {
    return this.req('/health', { responseSchema: HealthResponseSchema })
  }

  async shutdown(): Promise<ShutdownResponse> {
    return this.req('/shutdown', { method: 'POST', responseSchema: ShutdownResponseSchema })
  }

  async getVault(): Promise<VaultState> {
    return this.req('/vault', { responseSchema: VaultStateSchema })
  }

  async addReadPath(path: string): Promise<VaultState> {
    await this.req('/vault/read-paths', {
      body: AddReadPathRequestSchema.parse({ path }),
      method: 'POST',
      responseSchema: ReadPathsMutationResponseSchema,
    })
    return this.getVault()
  }

  async removeReadPath(path: string): Promise<VaultState> {
    await this.req(`/vault/read-paths/${encodeURIComponent(path)}`, {
      method: 'DELETE',
      responseSchema: ReadPathsMutationResponseSchema,
    })
    return this.getVault()
  }

  async setWritePath(path: string): Promise<VaultState> {
    await this.req('/vault/write-path', {
      body: SetWritePathRequestSchema.parse({ path }),
      method: 'PUT',
      responseSchema: WritePathMutationResponseSchema,
    })
    return this.getVault()
  }

  async getGraph(): Promise<GraphState> {
    return this.req('/graph', { responseSchema: GraphStateSchema })
  }

  async postDelta(delta: unknown[], sessionId?: string): Promise<void> {
    const headers: Record<string, string> = {}
    if (sessionId) headers['X-Session-Id'] = sessionId
    await this.req('/graph/delta', {
      body: delta,
      expectNoContent: false,
      headers,
      method: 'POST',
      responseSchema: { parse: (value) => value },
    })
  }

  async createSession(): Promise<{ sessionId: string }> {
    return this.req('/sessions', { method: 'POST', responseSchema: SessionCreateResponseSchema })
  }

  async getSession(id: string): Promise<SessionInfo> {
    return this.req(`/sessions/${encodeURIComponent(id)}`, { responseSchema: SessionInfoSchema })
  }

  async deleteSession(id: string): Promise<void> {
    await this.req(`/sessions/${encodeURIComponent(id)}`, {
      expectNoContent: true,
      method: 'DELETE',
    })
  }

  async getSessionState(id: string): Promise<LiveStateSnapshot> {
    return this.req(`/sessions/${encodeURIComponent(id)}/state`, {
      responseSchema: LiveStateSnapshotSchema,
    })
  }

  async collapse(sessionId: string, folderId: string): Promise<unknown> {
    return this.req(
      `/sessions/${encodeURIComponent(sessionId)}/collapse/${encodeURIComponent(folderId)}`,
      { method: 'POST', responseSchema: { parse: (value: unknown) => value } },
    )
  }

  async expand(sessionId: string, folderId: string): Promise<unknown> {
    return this.req(
      `/sessions/${encodeURIComponent(sessionId)}/collapse/${encodeURIComponent(folderId)}`,
      { method: 'DELETE', responseSchema: { parse: (value: unknown) => value } },
    )
  }

  async setSelection(sessionId: string, req: SelectionRequest): Promise<SelectionResponse> {
    return this.req(`/sessions/${encodeURIComponent(sessionId)}/selection`, {
      body: SelectionRequestSchema.parse(req),
      method: 'POST',
      responseSchema: SelectionResponseSchema,
    })
  }

  async getProjectedGraph(sessionId: string): Promise<unknown> {
    return this.req(`/sessions/${encodeURIComponent(sessionId)}/projected-graph`, {
      responseSchema: { parse: (value: unknown) => value },
    })
  }

  async updateLayout(sessionId: string, partial: LayoutPartial): Promise<LayoutResponse> {
    return this.req(`/sessions/${encodeURIComponent(sessionId)}/layout`, {
      body: LayoutPartialSchema.parse(partial),
      method: 'PUT',
      responseSchema: LayoutResponseSchema,
    })
  }

  async getView(
    sessionId: string,
    opts?: { budget?: number; expand?: string[] },
  ): Promise<ViewResponse> {
    const params = new URLSearchParams()
    if (opts?.budget !== undefined) params.set('budget', String(opts.budget))
    for (const id of opts?.expand ?? []) params.append('expand', id)
    const query = params.toString()
    return this.req(
      `/sessions/${encodeURIComponent(sessionId)}/view${query ? `?${query}` : ''}`,
      { responseSchema: ViewResponseSchema },
    )
  }

  // --- 0.3.0 graph admin ---

  async undo(): Promise<UndoResponse> {
    return this.req('/graph/undo', { method: 'POST', responseSchema: UndoResponseSchema })
  }

  async redo(): Promise<RedoResponse> {
    return this.req('/graph/redo', { method: 'POST', responseSchema: RedoResponseSchema })
  }

  async writePositions(): Promise<WritePositionsResponse> {
    return this.req('/graph/positions', { method: 'PUT', responseSchema: WritePositionsResponseSchema })
  }

  async reloadGraph(): Promise<GraphState> {
    return this.req('/graph/reload', { method: 'POST', responseSchema: GraphStateSchema })
  }

  // --- 0.3.0 vault extension ---

  async loadAndMergeVaultPath(
    vaultPath: string,
    opts?: { isWritePath?: boolean; createStarterIfEmpty?: boolean },
  ): Promise<LoadAndMergeResponse> {
    return this.req('/vault/load-and-merge', {
      body: LoadAndMergeRequestSchema.parse({
        vaultPath,
        isWritePath: opts?.isWritePath,
        createStarterIfEmpty: opts?.createStarterIfEmpty,
      }),
      method: 'POST',
      responseSchema: LoadAndMergeResponseSchema,
    })
  }

  private req<T>(path: string, opts: RequestOpts<T>): Promise<T> {
    return makeRequest(this.baseUrl, path, opts)
  }
}
