export type HttpResult =
  | { readonly kind: 'json'; readonly body: unknown; readonly status?: number }
  | { readonly kind: 'empty'; readonly status: number }
  | { readonly kind: 'notFound' }

export function jsonResult(body: unknown, status?: number): HttpResult {
  return { kind: 'json', body, status }
}

export function emptyResult(status: number): HttpResult {
  return { kind: 'empty', status }
}

export function notFoundResult(): HttpResult {
  return { kind: 'notFound' }
}

export function errorResult(
  error: string,
  code: string,
  status = 400,
): HttpResult {
  return jsonResult({ error, code }, status)
}
