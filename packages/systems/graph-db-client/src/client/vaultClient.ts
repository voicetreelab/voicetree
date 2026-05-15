import {
  AddReadPathRequestSchema,
  SetWritePathRequestSchema,
  VaultStateSchema,
  type VaultState,
} from '../contract.ts'
import {
  ReadPathsMutationResponseSchema,
  WritePathMutationResponseSchema,
} from '../responseSchemas.ts'
import type { RequestClient } from './requestCore.ts'

export type VaultClient = ReturnType<typeof createVaultClient>

export function createVaultClient(request: RequestClient) {
  async function getVault(): Promise<VaultState> {
    return await request('/vault', {
      responseSchema: VaultStateSchema,
    })
  }

  return {
    getVault,

    async addReadPath(path: string): Promise<VaultState> {
      await request('/vault/read-paths', {
        body: AddReadPathRequestSchema.parse({ path }),
        method: 'POST',
        responseSchema: ReadPathsMutationResponseSchema,
      })
      return await getVault()
    },

    async removeReadPath(path: string): Promise<VaultState> {
      await request(`/vault/read-paths/${encodeURIComponent(path)}`, {
        method: 'DELETE',
        responseSchema: ReadPathsMutationResponseSchema,
      })
      return await getVault()
    },

    async setWritePath(path: string): Promise<VaultState> {
      await request('/vault/write-path', {
        body: SetWritePathRequestSchema.parse({ path }),
        method: 'PUT',
        responseSchema: WritePathMutationResponseSchema,
      })
      return await getVault()
    },
  }
}
