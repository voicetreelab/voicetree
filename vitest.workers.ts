import { readFileSync } from 'node:fs'
import { availableParallelism, freemem, loadavg } from 'node:os'

// How many vitest worker forks to run, derived from the host — and, crucially,
// from what is CURRENTLY FREE on it, not its total capacity. The same config is
// fast on the idle 64c/188GB devbox, safe on a small CI runner, AND degrades
// gracefully when several suites run at once (this devbox routinely has many
// agents working in parallel, each able to start `npm run test`).
//
// Sizing each run to the WHOLE box — the prior `min(cores/2, total-RAM-budget)` —
// is a tragedy of the commons: every concurrent run independently claims the
// whole machine, so they collectively oversubscribe. On the 64c/188GB devbox
// (measured: 4f→208s, 16f→69s, 32f→64s, 64f→77s) two runs already reach the
// cores/2 knee past which wall time REGRESSES and timer tests flake, and ~4 runs
// at 1.5 GB/fork exceed physical RAM and re-trigger the OOM cascade the cap
// exists to prevent. The fix is to react to live load on both axes.

export const PER_FORK_GB = 1.5
export const MEMORY_UTILISATION = 0.75

export type HostLoad = {
  /** Logical cores (availableParallelism). */
  cores: number
  /** 1-minute load average — cores currently busy with OTHER work. */
  loadAvg1m: number
  /** Memory that can be claimed without paging — Linux MemAvailable, else freemem. */
  availableMemGb: number
  /** VITEST_MAX_FORKS, if set: a deterministic pin that overrides the heuristic. */
  envOverride?: number
}

/**
 * Pure: HostLoad → fork count. Both ceilings react to live load so that N
 * concurrent suites SHARE the host instead of each claiming all of it:
 *   • CPU — target the ~cores/2 knee, but on the IDLE cores only (cores minus
 *     the load average). A single run on an idle box still claims ~cores/2; a
 *     run starting while another saturates the box sees few idle cores and backs
 *     off. (Two equal runs settle near cores/3 each — a mild overshoot of the
 *     knee, not the 2x thrash of two full-box runs.)
 *   • RAM — budget against AVAILABLE memory at ~1.5 GB/fork. This is the hard
 *     guard: a run that starts while others hold forks sees less headroom and
 *     sizes toward serial, so total fork RAM can never push the box past
 *     physical memory. Unlike load average it reacts instantly (no 1-min lag),
 *     so it also covers two runs that start in the same minute.
 * VITEST_MAX_FORKS pins the count when a deterministic budget is wanted.
 */
export const resolveMaxWorkers = (host: HostLoad): number => {
  if (host.envOverride !== undefined && Number.isFinite(host.envOverride) && host.envOverride > 0) {
    return Math.max(1, Math.floor(host.envOverride))
  }
  const idleCores = Math.max(2, host.cores - Math.round(host.loadAvg1m))
  const cpuCeiling = Math.max(1, Math.floor(idleCores / 2))
  const memCeiling = Math.max(1, Math.floor((host.availableMemGb * MEMORY_UTILISATION) / PER_FORK_GB))
  return Math.min(cpuCeiling, memCeiling)
}

/**
 * os.freemem() on Linux is MemFree (excludes reclaimable page cache), which
 * badly under-reports after an IO-heavy suite and would needlessly serialise the
 * next run. Prefer MemAvailable from /proc/meminfo; fall back to freemem()
 * elsewhere (macOS CI, etc.).
 */
const readAvailableMemGb = (): number => {
  try {
    const match = readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)\s+kB/m)
    if (match) return Number(match[1]) / 1024 ** 2
  } catch {
    // not Linux, or /proc unreadable — fall through to freemem()
  }
  return freemem() / 1024 ** 3
}

/** Impure shell: snapshot the live host into a HostLoad. */
export const readHostLoad = (): HostLoad => {
  const fromEnv = Number(process.env.VITEST_MAX_FORKS)
  return {
    cores: availableParallelism(),
    loadAvg1m: loadavg()[0],
    availableMemGb: readAvailableMemGb(),
    envOverride: Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : undefined,
  }
}
