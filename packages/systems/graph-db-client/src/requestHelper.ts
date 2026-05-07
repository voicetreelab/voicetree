import { GraphDbClientError } from './errors.ts'

export type Schema<T> = { parse(input: unknown): T }

export type RequestOpts<T> = {
  body?: unknown
  expectNoContent?: boolean
  headers?: Record<string, string>
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  responseSchema?: Schema<T>
}

async function parseErrorPayload(
  response: Response,
): Promise<{ code?: string; error?: string; message?: string }> {
  try {
    const body = (await response.json()) as unknown
    if (typeof body !== 'object' || body === null) return {}
    const b = body as Record<string, unknown>
    return {
      code: typeof b.code === 'string' ? b.code : undefined,
      error: typeof b.error === 'string' ? b.error : undefined,
      message: typeof b.message === 'string' ? b.message : undefined,
    }
  } catch {
    return {}
  }
}

export async function makeRequest<T>(
  baseUrl: string,
  path: string,
  opts: RequestOpts<T>,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: {
      ...(opts.body === undefined ? undefined : { 'content-type': 'application/json' }),
      ...opts.headers,
    },
    method: opts.method ?? 'GET',
  })

  if (!response.ok) {
    const payload = await parseErrorPayload(response)
    const code = payload.code ?? `http_${response.status}`
    const message = payload.message ?? payload.error ?? response.statusText
    throw new GraphDbClientError(response.status, code, message)
  }

  if (opts.expectNoContent) return undefined as T

  if (!opts.responseSchema) {
    throw new Error(`Missing response schema for ${opts.method ?? 'GET'} ${path}`)
  }

  return opts.responseSchema.parse(await response.json())
}
