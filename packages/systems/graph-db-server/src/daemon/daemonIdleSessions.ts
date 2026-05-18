import { SessionRegistry } from '../application/session/registry.ts'

export function createIdleSessionTimer(
  registry: SessionRegistry,
  idleTimeoutMs: number,
): () => void {
  let idleSessionTimer: ReturnType<typeof setInterval> | null = setInterval(
    () => {
      registry.purgeIdle(idleTimeoutMs)
    },
    60_000,
  )
  idleSessionTimer.unref()

  return () => {
    if (!idleSessionTimer) {
      return
    }
    clearInterval(idleSessionTimer)
    idleSessionTimer = null
  }
}
