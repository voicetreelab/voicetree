export {
  CONTRACT_VERSION,
  HealthResponseSchema,
  ShutdownResponseSchema,
  type HealthResponse,
  type ShutdownResponse,
} from '@vt/graph-db-server/contract'

import type { HealthResponse } from '@vt/graph-db-server/contract'

export class GraphDbClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<HealthResponse> {
    void this.baseUrl
    throw new Error('NOT_IMPLEMENTED_UNTIL_BF_217')
  }
}
