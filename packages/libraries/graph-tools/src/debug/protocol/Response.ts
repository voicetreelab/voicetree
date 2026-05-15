export type Response<T> =
  | { ok: true; command: string; result: T }
  | { ok: false; command: string; error: string; hint?: string; exitCode?: number }

export function ok<T>(command: string, result: T): Response<T> {
  return { ok: true, command, result }
}

export function err(
  command: string,
  error: string,
  hint?: string,
  exitCode?: number,
): Response<never> {
  return {
    ok: false,
    command,
    error,
    ...(hint !== undefined ? { hint } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  }
}
