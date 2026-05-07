import {
  BuildIndexRequestSchema,
  FindFileResponseSchema,
  SearchResponseSchema,
  type FindFileResponse,
  type SearchResponse,
} from '@vt/graph-db-server/contract'
import { makeRequest } from './requestHelper.ts'

export async function buildSearchIndex(baseUrl: string, vaultPath: string): Promise<{ ok: true }> {
  return makeRequest(baseUrl, '/search/build-index', {
    body: BuildIndexRequestSchema.parse({ vaultPath }),
    method: 'POST',
    responseSchema: { parse: (v: unknown) => v as { ok: true } },
  })
}

export async function search(
  baseUrl: string,
  query: string,
  opts?: { vaultPath?: string; topK?: number },
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query })
  if (opts?.vaultPath) params.set('vaultPath', opts.vaultPath)
  if (opts?.topK !== undefined) params.set('topK', String(opts.topK))
  return makeRequest(baseUrl, `/search?${params.toString()}`, {
    responseSchema: SearchResponseSchema,
  })
}

export async function findFileByName(
  baseUrl: string,
  name: string,
  searchPath?: string,
): Promise<FindFileResponse> {
  const params = new URLSearchParams({ name })
  if (searchPath) params.set('searchPath', searchPath)
  return makeRequest(baseUrl, `/search/file?${params.toString()}`, {
    responseSchema: FindFileResponseSchema,
  })
}
