import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import {
  GraphDbClientError,
  ProjectNotOpenError,
  ProjectOpenFailedError,
} from '../errors.ts'
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
  error?: string | { code?: string; message?: string }
  message?: string
}

const tracer = trace.getTracer('vt-daemon-client')

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function routePath(path: string): string {
  return path.split('?')[0] ?? path
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
      error:
        typeof body.error === 'string'
          ? body.error
          : isObject(body.error)
            ? {
                code: typeof body.error.code === 'string' ? body.error.code : undefined,
                message:
                  typeof body.error.message === 'string' ? body.error.message : undefined,
              }
            : undefined,
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
  const nestedError = isObject(payload.error) ? payload.error : undefined
  const code = payload.code ?? nestedError?.code ?? `http_${response.status}`
  const message =
    payload.message
    ?? nestedError?.message
    ?? (typeof payload.error === 'string' ? payload.error : undefined)
    ?? response.statusText
  if (response.status === 409 && code === 'project_not_open') {
    return new ProjectNotOpenError(message)
  }
  if (response.status === 409 && code === 'project_open_failed') {
    return new ProjectOpenFailedError(message)
  }
  return new GraphDbClientError(response.status, code, message)
}

export function createRequest(baseUrl: string): RequestClient {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  return async function request<T>(
    path: string,
    opts: RequestOptions<T>,
  ): Promise<T> {
    const method = opts.method ?? 'GET'
    const route = routePath(path)
    return await tracer.startActiveSpan(
      `graphdb.http ${method} ${route}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'http.method': method,
          'http.route': route,
          'url.full': `${normalizedBaseUrl}${path}`,
        },
      },
      async (span): Promise<T> => {
        try {
          const body = opts.body === undefined ? undefined : JSON.stringify(opts.body)
          const headers: Record<string, string> = {
            ...(body === undefined ? undefined : { 'content-type': 'application/json' }),
            ...opts.headers,
          }
          propagation.inject(context.active(), headers)
          span.addEvent('graphdb.request.start', {
            'http.request.body.size': body?.length ?? 0,
          })

          const response = await fetch(`${normalizedBaseUrl}${path}`, {
            body,
            headers,
            method,
          })
          span.setAttribute('http.status_code', response.status)
          span.addEvent('graphdb.response.received')

          if (!response.ok) {
            const error = await toGraphDbClientError(response)
            span.setAttribute('graphdb.error.code', error.code)
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
            throw error
          }

          if (opts.expectNoContent) {
            return undefined as T
          }

          if (!opts.responseSchema) {
            throw new Error(`Missing response schema for ${method} ${path}`)
          }

          const parsed = opts.responseSchema.parse(await response.json())
          span.addEvent('graphdb.response.parsed')
          return parsed
        } catch (error) {
          span.recordException(error instanceof Error ? error : String(error))
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          })
          throw error
        } finally {
          span.end()
        }
      },
    )
  }
}
