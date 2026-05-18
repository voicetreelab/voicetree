import type { Context } from 'hono'
import type { HttpResult } from '../application/workflows/httpResult.ts'

export function sendHttpResult(c: Context, result: HttpResult): Response {
  if (result.kind === 'notFound') {
    return c.notFound() as Response
  }
  if (result.kind === 'empty') {
    return c.body(null, result.status as never) as Response
  }
  return c.json(result.body, result.status as never) as Response
}
