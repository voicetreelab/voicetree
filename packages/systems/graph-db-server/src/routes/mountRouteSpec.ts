import type { Context, Handler, Hono } from 'hono'
import type { DaemonRouteSpec } from './routeSpecs.ts'

function stripPrefix(path: string, prefix: string): string {
  if (!prefix) return path
  if (path === prefix) return '/'
  if (!path.startsWith(`${prefix}/`)) {
    throw new Error(`Route path ${path} does not start with prefix ${prefix}`)
  }
  return path.slice(prefix.length)
}

export function mountDaemonRoute(
  app: Hono,
  spec: Pick<DaemonRouteSpec, 'method' | 'path'>,
  handler: Handler,
  options: { readonly prefix?: string } = {},
): void {
  const path = stripPrefix(spec.path, options.prefix ?? '')
  switch (spec.method) {
    case 'DELETE':
      app.delete(path, handler)
      return
    case 'GET':
      app.get(path, handler)
      return
    case 'PATCH':
      app.patch(path, handler)
      return
    case 'POST':
      app.post(path, handler)
      return
    case 'PUT':
      app.put(path, handler)
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
