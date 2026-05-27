/**
 * Poll-timing primitives used by the ensure work-loop and the spawn-wait
 * loop. Pure functions with no dependencies — exported so both the
 * graph-db-client and vt-daemon-client ensure paths can use the same
 * backoff / sleep behaviour without copying it.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

/**
 * Double the current backoff but cap it at the supplied ceiling. The
 * ceiling is exclusive of jitter — callers add their own randomisation
 * if needed.
 */
export function nextBackoff(current: number, ceiling: number): number {
  return Math.min(current * 2, ceiling)
}

/**
 * Bound a sleep delay by the remaining time until a deadline. Returns 0
 * when the deadline has already passed so callers never sleep into the
 * timeout window.
 */
export function boundedDelay(backoff: number, deadlineMs: number): number {
  const remaining = deadlineMs - Date.now()
  if (remaining <= 0) return 0
  return Math.min(backoff, remaining)
}
