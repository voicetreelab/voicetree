import {
  AddReadPathRequestSchema,
  CollapseStateResponseSchema,
  GraphStateSchema,
  HealthResponseSchema,
  LayoutPartialSchema,
  LayoutResponseSchema,
  LiveStateSnapshotSchema,
  SelectionRequestSchema,
  SelectionResponseSchema,
  SessionCreateResponseSchema,
  SessionInfoSchema,
  SetWritePathRequestSchema,
  ShutdownResponseSchema,
  VaultStateSchema,
  type GraphState,
  type HealthResponse,
  type LayoutPartial,
  type LayoutResponse,
  type LiveStateSnapshot,
  type SelectionRequest,
  type SelectionResponse,
  type SessionInfo,
  type ShutdownResponse,
  type VaultState,
  type CollapseStateResponse,
} from '@vt/graph-db-server/contract'
import { DaemonUnreachableError, GraphDbClientError } from './errors.ts'
import { discoverPort } from './portDiscovery.ts'

type Schema<T> = {
  parse(input: unknown): T
}

type RequestOptions<T> = {
  body?: unknown
  expectNoContent?: boolean
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT'
  responseSchema?: Schema<T>
}

type ErrorPayload = {
  code?: string
  error?: string
  message?: string
}

const ReadPathsMutationResponseSchema: Schema<{ readPaths: string[] }> = {
  parse(input: unknown) {
    if (!isObject(input) || !Array.isArray(input.readPaths)) {
      throw new Error('Invalid read-paths response body')
    }
    if (!input.readPaths.every((value) => typeof value === 'string')) {
      throw new Error('Invalid read-paths response body')
    }
    return { readPaths: [...input.readPaths] }
  },
}

const WritePathMutationResponseSchema: Schema<{ writePath: string }> = {
  parse(input: unknown) {
    if (!isObject(input) || typeof input.writePath !== 'string') {
      throw new Error('Invalid write-path response body')
    }
    return { writePath: input.writePath }
  },
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function parseErrorPayload(response: Response): Promise<ErrorPayload> {
  try {
    const body = (await response.json()) as unknown
    if (!isObject(body)) {
      return {}
    }
    return {
      code: typeof body.code === 'string' ? body.code : undefined,
      error: typeof body.error === 'string' ? body.error : undefined,
      message: typeof body.message === 'string' ? body.message : undefined,
    }
  } catch {
    return {}
  }
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
    return await this.request('/health', {
      responseSchema: HealthResponseSchema,
    })
  }

  async shutdown(): Promise<ShutdownResponse> {
    return await this.request('/shutdown', {
      method: 'POST',
      responseSchema: ShutdownResponseSchema,
    })
  }

  async getVault(): Promise<VaultState> {
    return await this.request('/vault', {
      responseSchema: VaultStateSchema,
    })
  }

  async addReadPath(path: string): Promise<VaultState> {
    await this.request('/vault/read-paths', {
      body: AddReadPathRequestSchema.parse({ path }),
      method: 'POST',
      responseSchema: ReadPathsMutationResponseSchema,
    })
    return await this.getVault()
  }

  async removeReadPath(path: string): Promise<VaultState> {
    await this.request(`/vault/read-paths/${encodeURIComponent(path)}`, {
      method: 'DELETE',
      responseSchema: ReadPathsMutationResponseSchema,
    })
    return await this.getVault()
  }

  async setWritePath(path: string): Promise<VaultState> {
    await this.request('/vault/write-path', {
      body: SetWritePathRequestSchema.parse({ path }),
      method: 'PUT',
      responseSchema: WritePathMutationResponseSchema,
    })
    return await this.getVault()
  }

  async getGraph(): Promise<GraphState> {
    return await this.request('/graph', {
      responseSchema: GraphStateSchema,
    })
  }

  async createSession(): Promise<{ sessionId: string }> {
    return await this.request('/sessions', {
      method: 'POST',
      responseSchema: SessionCreateResponseSchema,
    })
  }

  async getSession(id: string): Promise<SessionInfo> {
    return await this.request(`/sessions/${encodeURIComponent(id)}`, {
      responseSchema: SessionInfoSchema,
    })
  }

  async deleteSession(id: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(id)}`, {
      expectNoContent: true,
      method: 'DELETE',
    })
  }

  async getSessionState(id: string): Promise<LiveStateSnapshot> {
    return await this.request(`/sessions/${encodeURIComponent(id)}/state`, {
      responseSchema: LiveStateSnapshotSchema,
    })
  }

  async collapse(
    sessionId: string,
    folderId: string,
  ): Promise<CollapseStateResponse> {
    return await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/collapse/${encodeURIComponent(folderId)}`,
      {
        method: 'POST',
        responseSchema: CollapseStateResponseSchema,
      },
    )
  }

  async expand(
    sessionId: string,
    folderId: string,
  ): Promise<CollapseStateResponse> {
    return await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/collapse/${encodeURIComponent(folderId)}`,
      {
        method: 'DELETE',
        responseSchema: CollapseStateResponseSchema,
      },
    )
  }

  async setSelection(
    sessionId: string,
    req: SelectionRequest,
  ): Promise<SelectionResponse> {
    return await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/selection`,
      {
        body: SelectionRequestSchema.parse(req),
        method: 'POST',
        responseSchema: SelectionResponseSchema,
      },
    )
  }

  async updateLayout(
    sessionId: string,
    partial: LayoutPartial,
  ): Promise<LayoutResponse> {
    return await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/layout`,
      {
        body: LayoutPartialSchema.parse(partial),
        method: 'PUT',
        responseSchema: LayoutResponseSchema,
      },
    )
  }

  private async request<T>(
    path: string,
    opts: RequestOptions<T>,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      headers:
        opts.body === undefined ? undefined : { 'content-type': 'application/json' },
      method: opts.method ?? 'GET',
    })

    if (!response.ok) {
      throw await this.toGraphDbClientError(response)
    }

    if (opts.expectNoContent) {
      return undefined as T
    }

    if (!opts.responseSchema) {
      throw new Error(`Missing response schema for ${opts.method ?? 'GET'} ${path}`)
    }

    return opts.responseSchema.parse(await response.json())
  }

  private async toGraphDbClientError(
    response: Response,
  ): Promise<GraphDbClientError> {
    const payload = await parseErrorPayload(response)
    const code = payload.code ?? `http_${response.status}`
    const message = payload.message ?? payload.error ?? response.statusText
    return new GraphDbClientError(response.status, code, message)
  }
}
