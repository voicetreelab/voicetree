import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import {
  GraphDbClientError,
  GraphDbRequestTimeoutError,
  ProjectNotOpenError,
  ProjectOpenFailedError,
} from '../errors.ts'
import type { Schema } from '../responseSchemas.ts'

/**
 * Hard ceiling for a single graphd request when the caller does not supply
 * one. Generous enough to never abort a legitimate cold-start project parse,
 * but bounded so a daemon that accepts the socket and then stalls converts
 * into a thrown {@link GraphDbRequestTimeoutError} instead of an `await`
 * that never settles. Mirrors `VtDaemonClient`'s `DEFAULT_TIMEOUT_MS` — the
 * sibling client already had this guard; graphd's transport did not.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

export type RequestOptions<T> = {
  body?: unknown
  expectNoContent?: boolean
  headers?: Record<string, string>
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
  responseSchema?: Schema<T>
  /**
   * Override the per-request deadline. Defaults to
   * {@link DEFAULT_REQUEST_TIMEOUT_MS}. The timer covers the whole exchange
   * (connect, response headers, and body read) — aborting the signal errors
   * an in-flight body stream too.
   */
  timeoutMs?: number
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
        const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
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
            signal: controller.signal,
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
          // A fetch/body-read rejection caused by our own deadline surfaces
          // as an opaque AbortError; rewrite it to the typed timeout so the
          // caller (e.g. openProject) can distinguish "daemon stalled" from
          // a real protocol error and react instead of hanging.
          const surfaced = controller.signal.aborted
            ? new GraphDbRequestTimeoutError(method, route, timeoutMs)
            : error
          span.recordException(surfaced instanceof Error ? surfaced : String(surfaced))
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: surfaced instanceof Error ? surfaced.message : String(surfaced),
          })
          throw surfaced
        } finally {
          clearTimeout(timer)
          span.end()
        }
      },
    )
  }
}
