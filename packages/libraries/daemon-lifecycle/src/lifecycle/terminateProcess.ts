/**
 * Escalating process termination.
 *
 * Sends SIGTERM, waits a bounded grace period for the process to exit,
 * and — if it is still alive — escalates to the uncatchable SIGKILL with
 * a second grace window. Returns a discriminated outcome describing how
 * (or whether) the process died.
 *
 * This is the reclamation backstop: a daemon whose graceful-shutdown
 * handler has wedged (e.g. an `await` that never resolves, with the
 * shutdown latch swallowing every subsequent SIGTERM) is immortal under a
 * SIGTERM-only reclaim. Only SIGKILL is guaranteed to reap it. Callers
 * must establish authority to kill BEFORE calling — `decideOwnerAction`
 * only routes to reclamation when the recorded pid is dead, or alive with
 * a positively-matching command fingerprint, so SIGKILL here cannot land
 * on an unrelated reused pid that the owner record happens to name.
 *
 * Liveness is read via {@link readProcessLiveness}, which reports
 * `unknown` (not `dead`) for an EPERM probe — a pid we cannot signal. We
 * therefore only ever report `terminated-*` on a positively-observed
 * `dead`, never on the absence of a confirmation.
 */

import { readProcessLiveness } from './processLiveness.ts'
import { sleep } from '../pollTimings.ts'

export type TerminateOutcome =
  | 'already-dead'
  | 'terminated-sigterm'
  | 'terminated-sigkill'
  | 'undead'

export type TerminateProcessOptions = {
  /** Grace period to wait for a clean exit after SIGTERM. */
  readonly sigtermGraceMs: number
  /** Grace period to wait for exit after escalating to SIGKILL. */
  readonly sigkillGraceMs: number
  /** Liveness poll cadence inside each grace window. Defaults to 25ms. */
  readonly pollIntervalMs?: number
}

const DEFAULT_POLL_INTERVAL_MS = 25

export async function terminateProcess(
  pid: number,
  options: TerminateProcessOptions,
): Promise<TerminateOutcome> {
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  if (readProcessLiveness(pid) !== 'alive') return 'already-dead'

  trySignal(pid, 'SIGTERM')
  if (await waitForDeath(pid, options.sigtermGraceMs, pollMs)) {
    return 'terminated-sigterm'
  }

  // SIGTERM was ignored — almost always a daemon wedged mid-shutdown.
  // Escalate to the signal a process cannot trap or latch past.
  trySignal(pid, 'SIGKILL')
  if (await waitForDeath(pid, options.sigkillGraceMs, pollMs)) {
    return 'terminated-sigkill'
  }

  return 'undead'
}

function trySignal(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // ESRCH (already gone) or EPERM (not ours to signal) — the caller's
    // waitForDeath / liveness read decides the outcome, not the throw.
  }
}

/**
 * Poll liveness until the pid is positively `dead` or the grace window
 * elapses. Returns true only on an observed `dead` — an `unknown`
 * (EPERM) read never counts as death.
 */
async function waitForDeath(
  pid: number,
  graceMs: number,
  pollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (readProcessLiveness(pid) === 'dead') return true
    await sleep(pollMs)
  }
  return readProcessLiveness(pid) === 'dead'
}
