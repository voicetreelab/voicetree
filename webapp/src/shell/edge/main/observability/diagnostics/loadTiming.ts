let activeLoadId: string | null = null
let activeLoadStartedAt: number = 0

export function startLoadTiming(directory: string): string {
  const id: string = `load-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  activeLoadId = id
  activeLoadStartedAt = Date.now()
  emit('loadFolder:start', { dir: directory })
  return id
}

export function markLoadTiming(event: string, extra?: Record<string, unknown>): void {
  if (activeLoadId === null) return
  emit(event, extra)
}

export function isLoadTimingActive(): boolean {
  return activeLoadId !== null
}

function emit(event: string, extra?: Record<string, unknown>): void {
  if (activeLoadId === null) return
  const elapsedMs: number = Date.now() - activeLoadStartedAt
  const parts: string[] = [
    `ts=${new Date().toISOString()}`,
    `event=${event}`,
    `id=${activeLoadId}`,
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
