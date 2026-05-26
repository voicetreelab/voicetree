/**
 * Caller-driven parent-pid watchdog.
 *
 * Polls `kill(parentPid, 0)` at a configurable interval and invokes
 * `onParentGone` exactly once when the parent disappears. The caller
 * supplies the parent pid explicitly — typically via the
 * `VOICETREE_PARENT_PID` env var injected by the spawner — so this
 * primitive is appropriate when the daemon's launcher is a long-lived
 * process whose exit should take the daemon with it (Electron Main,
 * vt CLI). Compare with {@link startParentWatch} which detects the
 * ppid==1 reparent that follows unclean parent death.
 */

export type ParentPidWatchdogOptions = {
  parentPid: number
  pollIntervalMs?: number
  onParentGone: () => void
  isAlive?: (pid: number) => boolean
  scheduler?: ParentPidWatchdogScheduler
}

export type ParentPidWatchdogScheduler = {
  setInterval: (fn: () => void, ms: number) => ParentPidWatchdogTimer
  clearInterval: (timer: ParentPidWatchdogTimer) => void
  setImmediate: (fn: () => void) => void
}

export type ParentPidWatchdogTimer = { unref?: () => void }

export type ParentPidWatchdogHandle = {
  stop: () => void
}

const DEFAULT_POLL_INTERVAL_MS = 2000

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return false
    return true
  }
}

const realScheduler: ParentPidWatchdogScheduler = {
  clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
  setImmediate: (fn) => { setImmediate(fn) },
  setInterval: (fn, ms) => setInterval(fn, ms) as unknown as ParentPidWatchdogTimer,
}

export function startParentPidWatchdog(opts: ParentPidWatchdogOptions): ParentPidWatchdogHandle {
  if (!Number.isInteger(opts.parentPid) || opts.parentPid <= 0) {
    throw new Error(`startParentPidWatchdog: invalid parentPid ${opts.parentPid}`)
  }

  const isAlive = opts.isAlive ?? defaultIsAlive
  const intervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const scheduler = opts.scheduler ?? realScheduler

  let fired = false
  let timer: ParentPidWatchdogTimer | null = null

  const fireOnce = (): void => {
    if (fired) return
    fired = true
    if (timer) {
      scheduler.clearInterval(timer)
      timer = null
    }
    opts.onParentGone()
  }

  const tick = (): void => {
    if (fired) return
    if (!isAlive(opts.parentPid)) fireOnce()
  }

  if (!isAlive(opts.parentPid)) {
    scheduler.setImmediate(fireOnce)
    return { stop: () => { fired = true } }
  }

  timer = scheduler.setInterval(tick, intervalMs)
  timer.unref?.()

  return {
    stop: () => {
      if (fired) return
      fired = true
      if (timer) {
        scheduler.clearInterval(timer)
        timer = null
      }
    },
  }
}
