// Detects when this daemon's original parent has died and the kernel
// reparented us to PID 1 (launchd on macOS, init on Linux). Used by the
// vaultless Electron-spawned daemon to self-exit when Electron crashes
// without going through will-quit — the only path the existing graceful
// shutdown covers. Works even under SIGKILL/jetsam of the parent because
// the daemon does the detecting, not the parent.

export type ParentWatchDeps = {
  getPpid: () => number
  setInterval: (cb: () => void, ms: number) => NodeJS.Timeout
  clearInterval: (handle: NodeJS.Timeout) => void
}

export type ParentWatchOptions = {
  pollIntervalMs?: number
  onOrphaned: () => void
}

export type ParentWatchHandle = {
  stop(): void
  // Test-only: snapshot of whether the watcher armed itself or no-op'd
  // because initial ppid was already 1 (launchd-spawned).
  readonly armed: boolean
}

const DEFAULT_POLL_INTERVAL_MS = 5000

const defaultDeps: ParentWatchDeps = {
  getPpid: () => process.ppid,
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (handle) => clearInterval(handle),
}

export function startParentWatch(
  opts: ParentWatchOptions,
  deps: ParentWatchDeps = defaultDeps,
): ParentWatchHandle {
  const initialPpid = deps.getPpid()
  if (initialPpid === 1) {
    return { armed: false, stop: () => {} }
  }

  let fired = false
  const intervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const handle = deps.setInterval(() => {
    if (fired) return
    if (deps.getPpid() === 1) {
      fired = true
      deps.clearInterval(handle)
      opts.onOrphaned()
    }
  }, intervalMs)

  if (typeof (handle as { unref?: () => void }).unref === 'function') {
    ;(handle as { unref: () => void }).unref()
  }

  return {
    armed: true,
    stop: () => {
      if (fired) return
      fired = true
      deps.clearInterval(handle)
    },
  }
}
