import {
  HealthResponseSchema,
  ShutdownResponseSchema,
  type HealthResponse,
  type ShutdownResponse,
} from '../contract.ts'
import { DaemonUnreachableError, GraphDbClientError } from '../errors.ts'
import { discoverPort } from '../portDiscovery.ts'
import type { RequestClient } from './requestCore.ts'

export type DaemonClient = ReturnType<typeof createDaemonClient>

export type ConnectOptions = {
  project: string
  sessionId?: string
}

export function createDaemonClient(request: RequestClient) {
  return {
    async health(): Promise<HealthResponse> {
      return await request('/health', {
        responseSchema: HealthResponseSchema,
      })
    },

    async shutdown(): Promise<ShutdownResponse> {
      return await request('/shutdown', {
        method: 'POST',
        responseSchema: ShutdownResponseSchema,
      })
    },
  }
}

export async function connect<TClient extends { health(): Promise<HealthResponse> }>(
  opts: ConnectOptions,
  createClient: (opts: { baseUrl: string; sessionId?: string }) => TClient,
): Promise<TClient> {
  const port = await discoverPort(opts.project)
  const client = createClient({
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
      `Discovered vt-graphd for project ${opts.project}, but /health was unreachable`,
    )
  }

  return client
}
