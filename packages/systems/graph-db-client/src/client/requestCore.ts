import { GraphDbClientError } from '../errors.ts'
import type { Schema } from '../responseSchemas.ts'

export type RequestOptions<T> = {
  body?: unknown
  expectNoContent?: boolean
  headers?: Record<string, string>
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  responseSchema?: Schema<T>
}

export type RequestClient = <T>(
  path: string,
  opts: RequestOptions<T>,
) => Promise<T>

type ErrorPayload = {
  code?: string
  error?: string
  message?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

export async function parseErrorPayload(response: Response): Promise<ErrorPayload> {
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

export async function toGraphDbClientError(
  response: Response,
): Promise<GraphDbClientError> {
  const payload = await parseErrorPayload(response)
  const code = payload.code ?? `http_${response.status}`
  const message = payload.message ?? payload.error ?? response.statusText
  return new GraphDbClientError(response.status, code, message)
}

export function createRequest(baseUrl: string): RequestClient {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  return async function request<T>(
    path: string,
    opts: RequestOptions<T>,
  ): Promise<T> {
    const response = await fetch(`${normalizedBaseUrl}${path}`, {
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
      throw await toGraphDbClientError(response)
    }

    if (opts.expectNoContent) {
      return undefined as T
    }

    if (!opts.responseSchema) {
      throw new Error(`Missing response schema for ${opts.method ?? 'GET'} ${path}`)
    }

    return opts.responseSchema.parse(await response.json())
  }
}
