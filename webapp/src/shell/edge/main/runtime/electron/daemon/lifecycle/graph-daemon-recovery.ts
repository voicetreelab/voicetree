/**
 * Bounded owner-mediated recovery for Electron (BF-347).
 *
 * When Electron detects daemon unhealth (e.g. an RPC connection failure
 * from `callDaemon`), the next ensure must satisfy two invariants from
 * the spec:
 *
 * 1. **Stop stale loops before recovery.** SSE subscription and the
 *    watch-sync poller keep retrying on their own timers and will
 *    keep failing while the daemon is gone. Recovery stops both
 *    BEFORE attempting `ensureGraphDaemonForVault` so the recovery
 *    call is the only thing reaching for the daemon, and the loops
 *    do not waste cycles racing the recovery attempt or — worse —
 *    accidentally drive a re-ensure of their own in the future.
 *
 * 2. **Recovery is bounded.** `decideRecoveryAttempt` is a pure
 *    function over a sliding window of attempt timestamps that
 *    returns `'allowed'` until `maxAttempts` recoveries have happened
 *    inside `windowMs`. After that the window must elapse before any
 *    further attempt is permitted; callers receive a typed
 *    {@link RecoveryExhaustedError} they can render to the user.
 *
 * Per-vault history lives in this module so multiple Electron callers
 * (callDaemon, future probes) share the same bound. The pure decision is
 * exported separately so tests assert the bound without any IO.
 */

import {
  ensureGraphDaemonForVault,
  type CallerKind,
  type EnsureGraphDaemonOptions,
  type EnsureGraphDaemonResult,
} from '@vt/graph-db-client'

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_WINDOW_MS = 30_000

/**
 * Pure decision: should this recovery attempt be allowed given the
 * recorded history?
 *
 * The history is a slice of millisecond timestamps. Returns `'allowed'`
 * when fewer than `policy.maxAttempts` of those timestamps fall inside
 * `[nowMs - policy.windowMs, nowMs]`; otherwise `'suppressed'`.
 */
export type RecoveryDecision = 'allowed' | 'suppressed'

export type RecoveryPolicy = {
  readonly maxAttempts: number
  readonly windowMs: number
}

export function decideRecoveryAttempt(
  nowMs: number,
  attemptTimestampsMs: readonly number[],
  policy: RecoveryPolicy,
): RecoveryDecision {
  const cutoff = nowMs - policy.windowMs
  const recent = attemptTimestampsMs.filter((t) => t > cutoff)
  return recent.length < policy.maxAttempts ? 'allowed' : 'suppressed'
}

/**
 * Raised by {@link attemptBoundedRecovery} when the per-vault recovery
 * budget is exhausted inside the configured window. Listeners (renderer
 * toast, status bar) can render `untilMs` to tell the user when retries
 * become possible again.
 */
export class RecoveryExhaustedError extends Error {
  constructor(
    readonly canonicalProjectRoot: string,
    readonly attemptsInWindow: number,
    readonly windowMs: number,
    readonly untilMs: number,
  ) {
    super(
      `Electron recovery for vault ${canonicalProjectRoot} exhausted: `
      + `${attemptsInWindow} attempts in ${windowMs}ms; next allowed at `
      + `${new Date(untilMs).toISOString()}`,
    )
    this.name = 'RecoveryExhaustedError'
  }
}

export type StopRecoveryLoopsFn = () => Promise<void> | void

export type EnsureForRecoveryFn = (
  vault: string,
  caller: CallerKind,
  options?: EnsureGraphDaemonOptions,
) => Promise<EnsureGraphDaemonResult>

export type BoundedRecoveryOptions = {
  /**
   * Override the per-vault attempt cap. Default 3.
   */
  readonly maxAttempts?: number
  /**
   * Override the sliding window. Default 30s.
   */
  readonly windowMs?: number
  /**
   * Stop SSE + watch-sync loops BEFORE the ensure call. The default
   * adapter calls `unsubscribeFromDaemonSSE()` and `stopDaemonGraphSync()`;
   * tests inject a spy.
   */
  readonly stopLoops?: StopRecoveryLoopsFn
  /**
   * Override the ensure call. Default is the shared
   * `ensureGraphDaemonForVault`. Tests inject a fake so they do not
   * launch a real vt-graphd.
   */
  readonly ensureFn?: EnsureForRecoveryFn
  /**
   * Override the timestamp source so tests can use a virtual clock.
   * Default `Date.now`.
   */
  readonly now?: () => number
}

type RecoveryHistory = {
  attempts: number[]
}

const historyByVault = new Map<string, RecoveryHistory>()

/**
 * Public entry: stop the stale loops, check the bound, attempt one
 * owner-mediated ensure, and record the attempt. Throws
 * {@link RecoveryExhaustedError} when the budget is exhausted (without
 * calling ensure). Lets `ensureGraphDaemonForVault` errors propagate.
 */
export async function attemptBoundedRecovery(
  canonicalProjectRoot: string,
  caller: CallerKind,
  options: BoundedRecoveryOptions = {},
): Promise<EnsureGraphDaemonResult> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const now = options.now ?? Date.now
  const ensureFn = options.ensureFn ?? ensureGraphDaemonForVault
  const stopLoops = options.stopLoops

  // Stop SSE + watch-sync BEFORE deciding so loops aren't running
  // while we evaluate budget. Idempotent on both sides.
  if (stopLoops) await stopLoops()

  const nowMs = now()
  const history = ensureHistory(canonicalProjectRoot)
  pruneOutsideWindow(history, nowMs, windowMs)

  const decision = decideRecoveryAttempt(nowMs, history.attempts, {
    maxAttempts,
    windowMs,
  })

  if (decision === 'suppressed') {
    const oldest = history.attempts[0] ?? nowMs
    const untilMs = oldest + windowMs
    throw new RecoveryExhaustedError(
      canonicalProjectRoot,
      history.attempts.length,
      windowMs,
      untilMs,
    )
  }

  history.attempts.push(nowMs)
  return ensureFn(canonicalProjectRoot, caller)
}

/**
 * Clear recovery history for a vault. Used when switching vaults so the
 * fresh vault starts with a clean attempt budget.
 */
export function resetRecoveryHistory(canonicalProjectRoot: string): void {
  historyByVault.delete(canonicalProjectRoot)
}

/**
 * Clear all recovery state. Test-only — production has no need to drop
 * history across vaults.
 */
export function __resetAllRecoveryHistoryForTest(): void {
  historyByVault.clear()
}

function ensureHistory(canonicalProjectRoot: string): RecoveryHistory {
  const existing = historyByVault.get(canonicalProjectRoot)
  if (existing) return existing
  const created: RecoveryHistory = { attempts: [] }
  historyByVault.set(canonicalProjectRoot, created)
  return created
}

function pruneOutsideWindow(
  history: RecoveryHistory,
  nowMs: number,
  windowMs: number,
): void {
  const cutoff = nowMs - windowMs
  history.attempts = history.attempts.filter((t) => t > cutoff)
}
