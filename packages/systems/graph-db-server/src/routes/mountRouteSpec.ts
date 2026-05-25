import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import type { Context, Handler, Hono } from 'hono'
import type { DaemonRouteSpec } from './routeSpecs.ts'

const tracer = trace.getTracer('vt-graphd')

function stripPrefix(path: string, prefix: string): string {
  if (!prefix) return path
  if (path === prefix) return '/'
  if (!path.startsWith(`${prefix}/`)) {
    throw new Error(`Route path ${path} does not start with prefix ${prefix}`)
  }
  return path.slice(prefix.length)
}

function requestHeaders(c: Context): Record<string, string> {
  const headers: Record<string, string> = {}
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

function wrapTracedHandler(
  spec: Pick<DaemonRouteSpec, 'method' | 'path'>,
  handler: Handler,
): Handler {
  return async (c, next) => {
    const parentContext = propagation.extract(context.active(), requestHeaders(c))
    return await context.with(parentContext, async () => {
      return await tracer.startActiveSpan(
        `graphd.http ${spec.method} ${spec.path}`,
        {
          kind: SpanKind.SERVER,
          attributes: {
            'http.method': spec.method,
            'http.route': spec.path,
            'url.path': new URL(c.req.url).pathname,
          },
        },
        async (span): Promise<Response> => {
          try {
            span.addEvent('graphd.http.handler.start')
            const response = await handler(c, next)
            const status = response instanceof Response ? response.status : c.res.status
            span.setAttribute('http.status_code', status)
            span.addEvent('graphd.http.response.ready')
            if (status >= 500) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: `HTTP ${status}`,
              })
            }
            return response as Response
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
    })
  }
}

export function mountDaemonRoute(
  app: Hono,
  spec: Pick<DaemonRouteSpec, 'method' | 'path'>,
  handler: Handler,
  options: { readonly prefix?: string } = {},
): void {
  const path = stripPrefix(spec.path, options.prefix ?? '')
  const tracedHandler = wrapTracedHandler(spec, handler)
  switch (spec.method) {
    case 'DELETE':
      app.delete(path, tracedHandler)
      return
    case 'GET':
      app.get(path, tracedHandler)
      return
    case 'PATCH':
      app.patch(path, tracedHandler)
      return
    case 'POST':
      app.post(path, tracedHandler)
      return
    case 'PUT':
      app.put(path, tracedHandler)
      return
  }
}

export function routeParam(c: Context, name: string): string {
  const value = c.req.param(name)
  if (value === undefined) {
    throw new Error(`Missing route param: ${name}`)
  }
  return value
}
