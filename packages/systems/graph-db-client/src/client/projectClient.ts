import {
  AddReadPathRequestSchema,
  CloneViewRequestSchema,
  CreateViewRequestSchema,
  ListViewsResponseSchema,
  SetWriteFolderPathRequestSchema,
  ProjectStateSchema,
  ViewRecordSchema,
  type OpenProjectResponse,
  type ProjectState,
  type ViewRecord,
} from '../contract.ts'
import {
  OpenProjectResponseSchema,
  ReadPathsMutationResponseSchema,
  WriteFolderPathMutationResponseSchema,
} from '../responseSchemas.ts'
import type { RequestClient } from './requestCore.ts'

export type ProjectClient = ReturnType<typeof createProjectClient>

export function createProjectClient(request: RequestClient) {
  async function getProject(): Promise<ProjectState> {
    return await request('/project', {
      responseSchema: ProjectStateSchema,
    })
  }

  return {
    getProject,

    async openProject(
      path: string,
      opts: { writeFolderPath?: string } = {},
    ): Promise<OpenProjectResponse> {
      return await request('/project/open', {
        body: opts.writeFolderPath === undefined ? { path } : { path, writeFolderPath: opts.writeFolderPath },
        method: 'POST',
        responseSchema: OpenProjectResponseSchema,
      })
    },

    async closeProject(): Promise<void> {
      await request('/project/close', {
        expectNoContent: true,
        method: 'POST',
      })
    },

    async addReadPath(path: string): Promise<ProjectState> {
      await request('/project/read-paths', {
        body: AddReadPathRequestSchema.parse({ path }),
        method: 'POST',
        responseSchema: ReadPathsMutationResponseSchema,
      })
      return await getProject()
    },

    async removeReadPath(path: string): Promise<ProjectState> {
      await request(`/project/read-paths/${encodeURIComponent(path)}`, {
        method: 'DELETE',
        responseSchema: ReadPathsMutationResponseSchema,
      })
      return await getProject()
    },

    async setWriteFolderPath(path: string): Promise<ProjectState> {
      await request('/project/write-path', {
        body: SetWriteFolderPathRequestSchema.parse({ path }),
        method: 'PUT',
        responseSchema: WriteFolderPathMutationResponseSchema,
      })
      return await getProject()
    },

    views: {
      list: async (): Promise<readonly ViewRecord[]> =>
        await request('/project/views', {
          responseSchema: ListViewsResponseSchema,
        }),

      create: async (name: string): Promise<ViewRecord> =>
        await request('/project/views', {
          body: CreateViewRequestSchema.parse({ name }),
          method: 'POST',
          responseSchema: ViewRecordSchema,
        }),

      activate: async (viewId: string): Promise<ViewRecord> =>
        await request(`/project/views/${encodeURIComponent(viewId)}/activate`, {
          method: 'POST',
          responseSchema: ViewRecordSchema,
        }),

      clone: async (srcViewId: string, dstName: string): Promise<ViewRecord> =>
        await request(`/project/views/${encodeURIComponent(srcViewId)}/clone`, {
          body: CloneViewRequestSchema.parse({ name: dstName }),
          method: 'POST',
          responseSchema: ViewRecordSchema,
        }),

      delete: async (viewId: string): Promise<void> => {
        await request(`/project/views/${encodeURIComponent(viewId)}`, {
          expectNoContent: true,
          method: 'DELETE',
        })
      },
    } as const,
  }
}
