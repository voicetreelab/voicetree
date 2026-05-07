import {
  ProjectRootResponseSchema,
  SetProjectRootRequestSchema,
  WatchStatusResponseSchema,
  type ProjectRootResponse,
  type WatchStatusResponse,
} from '@vt/graph-db-server/contract'
import { makeRequest } from './requestHelper.ts'

export async function getProjectRoot(baseUrl: string): Promise<ProjectRootResponse> {
  return makeRequest(baseUrl, '/watch/project-root', {
    responseSchema: ProjectRootResponseSchema,
  })
}

export async function setProjectRoot(
  baseUrl: string,
  projectRoot: string,
): Promise<ProjectRootResponse> {
  return makeRequest(baseUrl, '/watch/project-root', {
    body: SetProjectRootRequestSchema.parse({ projectRoot }),
    method: 'PUT',
    responseSchema: ProjectRootResponseSchema,
  })
}

export async function getWatchStatus(baseUrl: string): Promise<WatchStatusResponse> {
  return makeRequest(baseUrl, '/watch/status', {
    responseSchema: WatchStatusResponseSchema,
  })
}
