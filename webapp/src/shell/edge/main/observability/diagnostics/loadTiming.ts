/**
 * A single load-timing session. Threaded explicitly through the caller (FP
 * pattern 2: state-threading) rather than held as module-level mutable state,
 * so two concurrent loads can never clobber a shared cell and the import graph
 * sees the state as an ordinary value.
 */
export type LoadTimingSession = {
  readonly id: string
  readonly startedAt: number
}

export function startLoadTiming(directory: string): LoadTimingSession {
  const timing: LoadTimingSession = {
    id: `load-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    startedAt: Date.now(),
  }
  emit(timing, 'loadFolder:start', { dir: directory })
  return timing
}

export function markLoadTiming(timing: LoadTimingSession, event: string, extra?: Record<string, unknown>): void {
  emit(timing, event, extra)
}

function emit(timing: LoadTimingSession, event: string, extra?: Record<string, unknown>): void {
  const elapsedMs: number = Date.now() - timing.startedAt
  const parts: string[] = [
    `ts=${new Date().toISOString()}`,
    `event=${event}`,
    `id=${timing.id}`,
    `elapsedMs=${elapsedMs}`,
  ]
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      parts.push(`${key}=${formatExtraValue(value)}`)
    }
  }
  process.stdout.write(`[load-timing] ${parts.join(' ')}\n`)
}

function formatExtraValue(value: unknown): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'string') return value.includes(' ') ? JSON.stringify(value) : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
