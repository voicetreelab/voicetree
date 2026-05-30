export type Response<T> =
  | { ok: true; command: string; result: T }
  | ErrorResponse

export type ErrorResponse = { ok: false; command: string; error: string; hint?: string; exitCode?: number }

export function ok<T>(command: string, result: T): Response<T> {
  return { ok: true, command, result }
}

// `err` constructs only the failure variant — returning the full `Response<never>`
// union here made the `ok: true` branch leak into call sites that expect an
// error-or-value type (e.g. `ErrorResponse | number`), failing assignability.
export function err(
  command: string,
  error: string,
  hint?: string,
  exitCode?: number,
): ErrorResponse {
  return {
    ok: false,
    command,
    error,
    ...(hint !== undefined ? { hint } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  }
}
