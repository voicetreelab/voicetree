import {
  AddReadPathRequestSchema,
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
  ViewResponseSchema,
  type GraphState,
  type HealthResponse,
  type LayoutPartial,
  type LayoutResponse,
  type LiveStateSnapshot,
  type SelectionRequest,
  type SelectionResponse,
  type SessionInfo,
  type ShutdownResponse,
  type UnseenNode,
  type VaultState,
  type ViewResponse,
} from './contract.ts'
import { DaemonUnreachableError, GraphDbClientError } from './errors.ts'
import { discoverPort } from './portDiscovery.ts'
import {
  ContextNodeFromQuestionResponseSchema,
  ContextNodeResponseSchema,
  FindFileMatchesResponseSchema,
  PreviewContainedNodeIdsResponseSchema,
  ReadPathsMutationResponseSchema,
  UndoRedoResponseSchema,
  UnknownResponseSchema,
  UnseenNodesResponseSchema,
  UpdateContextNodeContainedIdsResponseSchema,
  WritePathMutationResponseSchema,
  WritePositionsResponseSchema,
  type Schema,
} from './responseSchemas.ts'

type RequestOptions<T> = {
  body?: unknown
  expectNoContent?: boolean
  headers?: Record<string, string>
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  responseSchema?: Schema<T>
}

type GetSessionStateOptions = {
  readonly content?: 'full' | 'omit'
}

type ErrorPayload = {
  code?: string
  error?: string
  message?: string
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

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

function serializeDeltaForIpc(delta: unknown[]): unknown[] {
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

  async postDelta(delta: unknown[], sessionId?: string): Promise<void> {
    const headers: Record<string, string> = {}
    if (sessionId) {
      headers['X-Session-Id'] = sessionId
    }

    await this.request('/graph/delta', {
      body: delta,
      expectNoContent: false,
      headers,
      method: 'POST',
      responseSchema: UnknownResponseSchema,
    })
  }

  async applyGraphDelta(
    delta: unknown[],
    opts: { recordForUndo?: boolean; sessionId?: string } = {},
  ): Promise<void> {
    const headers: Record<string, string> = {}
    if (opts.sessionId) {
      headers['X-Session-Id'] = opts.sessionId
    }

    await this.request('/graph/apply-delta', {
      body: {
        delta: serializeDeltaForIpc(delta),
        recordForUndo: opts.recordForUndo,
      },
      expectNoContent: false,
      headers,
      method: 'POST',
      responseSchema: UnknownResponseSchema,
    })
  }

  async createContextNode(
    parentNodeId: string,
    semanticNodeIds: string[],
  ): Promise<{ nodeId: string }> {
    return await this.request('/graph/context-node', {
      body: { parentNodeId, semanticNodeIds },
      method: 'POST',
      responseSchema: ContextNodeResponseSchema,
    })
  }

  async createContextNodeFromQuestion(
    nodeIds: string[],
    question: string,
    semanticNodeIds: string[],
  ): Promise<{ nodeId: string; parentNodePath: string; title: string }> {
    return await this.request('/graph/context-node-from-question', {
      body: { nodeIds, question, semanticNodeIds },
      method: 'POST',
      responseSchema: ContextNodeFromQuestionResponseSchema,
    })
  }

  async createContextNodeFromSelectedNodes(
    taskNodeId: string,
    selectedNodeIds: readonly string[],
  ): Promise<{ nodeId: string }> {
    return await this.request('/graph/context-node-from-selected-nodes', {
      body: { taskNodeId, selectedNodeIds },
      method: 'POST',
      responseSchema: ContextNodeResponseSchema,
    })
  }

  async getUnseenNodesAroundContextNode(
    contextNodeId: string,
    searchFromNode?: string,
  ): Promise<readonly UnseenNode[]> {
    const result = await this.request('/graph/unseen-nodes-around-context-node', {
      body: { contextNodeId, searchFromNode },
      method: 'POST',
      responseSchema: UnseenNodesResponseSchema,
    })
    return result.nodes
  }

  async updateContextNodeContainedIds(
    contextNodeId: string,
    newNodeIds: readonly string[],
  ): Promise<void> {
    await this.request('/graph/context-node-contained-ids', {
      body: { contextNodeId, newNodeIds },
      method: 'PATCH',
      responseSchema: UpdateContextNodeContainedIdsResponseSchema,
    })
  }

  async writePositions(
    positions: Record<string, { x: number; y: number }>,
  ): Promise<{ written: number }> {
    return await this.request('/graph/write-positions', {
      body: { positions },
      method: 'POST',
      responseSchema: WritePositionsResponseSchema,
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

  async getSessionState(
    id: string,
    opts: GetSessionStateOptions = {},
  ): Promise<LiveStateSnapshot> {
    const contentQuery = opts.content === 'omit' ? '?content=omit' : ''
    return await this.request(`/sessions/${encodeURIComponent(id)}/state${contentQuery}`, {
      responseSchema: LiveStateSnapshotSchema,
    })
  }

  async collapse(
    sessionId: string,
    folderId: string,
  ): Promise<unknown> {
    return await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/collapse/${encodeURIComponent(folderId)}`,
      {
        method: 'POST',
        responseSchema: UnknownResponseSchema,
      },
    )
  }

  async expand(
    sessionId: string,
    folderId: string,
  ): Promise<unknown> {
    return await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/collapse/${encodeURIComponent(folderId)}`,
      {
        method: 'DELETE',
        responseSchema: UnknownResponseSchema,
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

  async findFileByName(name: string): Promise<string[]> {
    return await this.request(
      `/graph/find-file?name=${encodeURIComponent(name)}`,
      { responseSchema: FindFileMatchesResponseSchema },
    )
  }

  async undo(): Promise<boolean> {
    return await this.request('/graph/undo', {
      method: 'POST',
      responseSchema: UndoRedoResponseSchema,
    })
  }

  async redo(): Promise<boolean> {
    return await this.request('/graph/redo', {
      method: 'POST',
      responseSchema: UndoRedoResponseSchema,
    })
  }

  async getPreviewContainedNodeIds(nodeId: string): Promise<readonly string[]> {
    return await this.request(
      `/graph/preview-contained-nodes/${encodeURIComponent(nodeId)}`,
      { responseSchema: PreviewContainedNodeIdsResponseSchema },
    )
  }

  async getProjectedGraph(sessionId: string): Promise<unknown> {
    return await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/projected-graph`,
      {
        responseSchema: UnknownResponseSchema,
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

  async getView(
    sessionId: string,
    opts?: { budget?: number; expand?: string[] },
  ): Promise<ViewResponse> {
    const params = new URLSearchParams()
    if (opts?.budget !== undefined) params.set('budget', String(opts.budget))
    for (const id of opts?.expand ?? []) params.append('expand', id)
    const query = params.toString()
    const suffix = query ? `?${query}` : ''
    return await this.request(
      `/sessions/${encodeURIComponent(sessionId)}/view${suffix}`,
      { responseSchema: ViewResponseSchema },
    )
  }

  private async request<T>(
    path: string,
    opts: RequestOptions<T>,
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      headers: {
        ...(opts.body === undefined
          ? undefined
          : { 'content-type': 'application/json' }),
        ...opts.headers,
      },
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
