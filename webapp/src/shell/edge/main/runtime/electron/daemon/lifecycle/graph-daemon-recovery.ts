/**
 * Owner-mediated recovery for Electron (BF-347).
 *
 * When Electron detects daemon unhealth (e.g. an RPC connection failure
 * from `callDaemon`), the next ensure must satisfy two invariants from
 * the spec:
 *
 * 1. **Stop stale loops before recovery.** SSE subscription and the
 *    watch-sync poller keep retrying on their own timers and will
 *    keep failing while the daemon is gone. Recovery stops both
 *    BEFORE attempting `ensureGraphDaemonForProject` so the recovery
 *    call is the only thing reaching for the daemon, and the loops
 *    do not waste cycles racing the recovery attempt or — worse —
 *    accidentally drive a re-ensure of their own in the future.
 *
 * 2. **Recovery is bounded by the owner ensure path.**
 *    `ensureGraphDaemonForProject` is the only recovery boundary allowed
 *    to claim, wait for, reclaim, or spawn the daemon. It coalesces
 *    concurrent same-process callers, serialises cross-process spawns
 *    with the project spawn lock, and suppresses repeated failed launches
 *    with the per-project cooldown breadcrumb.
 *
 * Electron owns no recovery attempt history here. It has one active project
 * at a time and delegates the load-bearing fork-storm protection to the
 * shared graph-db-client owner infrastructure used by every caller.
 */

import { SpanStatusCode } from '@opentelemetry/api'

import {
  ensureGraphDaemonForProject,
  type CallerKind,
  type EnsureGraphDaemonOptions,
  type EnsureGraphDaemonResult,
} from '@vt/graph-db-client'

import { daemonTracer } from '@/shell/edge/main/observability/tracing/daemon-tracing'

export type StopRecoveryLoopsFn = () => Promise<void> | void

export type EnsureForRecoveryFn = (
  project: string,
  caller: CallerKind,
  options?: EnsureGraphDaemonOptions,
) => Promise<EnsureGraphDaemonResult>

export type OwnerMediatedRecoveryOptions = {
  /**
   * Stop SSE + watch-sync loops BEFORE the ensure call. The default
   * adapter calls `unsubscribeFromDaemonSSE()` and `stopDaemonGraphSync()`;
   * tests inject a spy.
   */
  readonly stopLoops?: StopRecoveryLoopsFn
  /**
   * Override the ensure call. Default is the shared
   * `ensureGraphDaemonForProject`. Tests inject a fake so they do not
   * launch a real vt-graphd.
   */
  readonly ensureFn?: EnsureForRecoveryFn
}

/**
 * Public entry: stop stale loops, then delegate exactly one recovery to
 * the shared owner-mediated ensure path. Typed cooldown/launch errors from
 * `ensureGraphDaemonForProject` propagate unchanged so callers can render
 * the owner infrastructure's suppression state.
 */
export async function attemptOwnerMediatedRecovery(
  canonicalProject: string,
  caller: CallerKind,
  options: OwnerMediatedRecoveryOptions = {},
): Promise<EnsureGraphDaemonResult> {
  return await daemonTracer().startActiveSpan('daemon.owner-mediated-recovery', async (span) => {
    try {
      span.setAttribute('project', canonicalProject)
      span.setAttribute('caller', caller)
      const ensureFn = options.ensureFn ?? ensureGraphDaemonForProject
      const stopLoops = options.stopLoops

      // Stop SSE + watch-sync BEFORE ensure so loops cannot race recovery
      // or reintroduce their own ensure path while the owner protocol runs.
      if (stopLoops) await stopLoops()

      const result = await ensureFn(canonicalProject, caller)
      span.setAttribute('recoveredPid', result.pid)
      span.setAttribute('launched', result.launched)
      return result
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) })
      throw error
    } finally {
      span.end()
    }
  })
}
