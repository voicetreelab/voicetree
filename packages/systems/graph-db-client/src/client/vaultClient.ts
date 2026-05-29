import {
  AddReadPathRequestSchema,
  CloneViewRequestSchema,
  CreateViewRequestSchema,
  ListViewsResponseSchema,
  SetWriteFolderPathRequestSchema,
  VaultStateSchema,
  ViewRecordSchema,
  type OpenVaultResponse,
  type VaultState,
  type ViewRecord,
} from '../contract.ts'
import {
  OpenVaultResponseSchema,
  ReadPathsMutationResponseSchema,
  WriteFolderPathMutationResponseSchema,
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
      opts: { writeFolderPath?: string } = {},
    ): Promise<OpenVaultResponse> {
      return await request('/vault/open', {
        body: opts.writeFolderPath === undefined ? { path } : { path, writeFolderPath: opts.writeFolderPath },
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

    async setWriteFolderPath(path: string): Promise<VaultState> {
      await request('/vault/write-path', {
        body: SetWriteFolderPathRequestSchema.parse({ path }),
        method: 'PUT',
        responseSchema: WriteFolderPathMutationResponseSchema,
      })
      return await getVault()
    },

    views: {
      list: async (): Promise<readonly ViewRecord[]> =>
        await request('/vault/views', {
          responseSchema: ListViewsResponseSchema,
        }),

      create: async (name: string): Promise<ViewRecord> =>
        await request('/vault/views', {
          body: CreateViewRequestSchema.parse({ name }),
          method: 'POST',
          responseSchema: ViewRecordSchema,
        }),

      activate: async (viewId: string): Promise<ViewRecord> =>
        await request(`/vault/views/${encodeURIComponent(viewId)}/activate`, {
          method: 'POST',
          responseSchema: ViewRecordSchema,
        }),

      clone: async (srcViewId: string, dstName: string): Promise<ViewRecord> =>
        await request(`/vault/views/${encodeURIComponent(srcViewId)}/clone`, {
          body: CloneViewRequestSchema.parse({ name: dstName }),
          method: 'POST',
          responseSchema: ViewRecordSchema,
        }),

      delete: async (viewId: string): Promise<void> => {
        await request(`/vault/views/${encodeURIComponent(viewId)}`, {
          expectNoContent: true,
          method: 'DELETE',
        })
      },
    } as const,
  }
}
