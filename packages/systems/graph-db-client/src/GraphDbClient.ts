import {
  connect,
  createDaemonClient,
  type ConnectOptions,
  type DaemonClient,
} from './client/daemonClient.ts'
import {
  createContextNodeClient,
  type ContextNodeClient,
} from './client/contextNodeClient.ts'
import {
  createGraphClient,
  type GraphClient,
} from './client/graphClient.ts'
import { createRequest, normalizeBaseUrl } from './client/requestCore.ts'
import {
  createSessionClient,
  type SessionClient,
} from './client/sessionClient.ts'
import {
  createProjectClient,
  type ProjectClient,
} from './client/projectClient.ts'

export type GraphDbClientOptions = {
  baseUrl: string
  sessionId?: string
}

export type GraphDbClientApi = {
  readonly baseUrl: string
  readonly sessionId?: string
} & ContextNodeClient &
  DaemonClient &
  GraphClient &
  SessionClient &
  ProjectClient

export function createGraphDbClient(opts: GraphDbClientOptions): GraphDbClientApi {
  const baseUrl = normalizeBaseUrl(opts.baseUrl)
  const request = createRequest(baseUrl)

  return {
    baseUrl,
    sessionId: opts.sessionId,
    ...createDaemonClient(request),
    ...createProjectClient(request),
    ...createGraphClient(request),
    ...createContextNodeClient(request),
    ...createSessionClient(request),
  }
}

export interface GraphDbClient extends GraphDbClientApi {}

export class GraphDbClient {
  constructor(opts: GraphDbClientOptions) {
    Object.assign(this, createGraphDbClient(opts))
  }

  static async connect(opts: ConnectOptions): Promise<GraphDbClient> {
    return await connect(opts, (clientOpts) => new GraphDbClient(clientOpts))
  }
}
