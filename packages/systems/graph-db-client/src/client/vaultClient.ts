import {
  AddReadPathRequestSchema,
  SetWritePathRequestSchema,
  VaultStateSchema,
  type OpenVaultResponse,
  type VaultState,
} from '../contract.ts'
import {
  OpenVaultResponseSchema,
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

    async openVault(
      path: string,
      opts: { writePath?: string } = {},
    ): Promise<OpenVaultResponse> {
      return await request('/vault/open', {
        body: opts.writePath === undefined ? { path } : { path, writePath: opts.writePath },
        method: 'POST',
        responseSchema: OpenVaultResponseSchema,
      })
    },

    async closeVault(): Promise<void> {
      await request('/vault/close', {
        expectNoContent: true,
        method: 'POST',
      })
    },

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
