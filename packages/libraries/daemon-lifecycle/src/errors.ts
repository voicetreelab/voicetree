/**
 * Typed error shapes raised by the daemon-lifecycle primitives. The same
 * shapes are surfaced by the per-daemon ensure orchestrators in
 * graph-db-client and (BF-373) vt-daemon-client, so subscribers can
 * pattern-match the lifecycle errors regardless of which daemon they
 * were waiting on.
 */

export class DaemonLaunchTimeout extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DaemonLaunchTimeout'
  }
}

/**
 * Refused to use or replace a daemon because identity checks failed
 * safely. The recorded owner pid is alive but its command fingerprint
 * or `/health` identity does not match the daemon we would have
 * launched for this vault — possibly a reused pid or an unrelated
 * program holding the same record. Stale reclamation never kills under
 * this condition.
 */
export class UnsafeOwnerError extends Error {
  constructor(
    public readonly vault: string,
    public readonly recordedPid: number,
    public readonly reason:
      | 'health-identity-mismatch'
      | 'fingerprint-mismatch'
      | 'fingerprint-unknown-stale',
  ) {
    super(
      `daemon owner for vault ${vault} is unsafe to reuse or reclaim (pid ${recordedPid}, reason ${reason})`,
    )
    this.name = 'UnsafeOwnerError'
  }
}

/**
 * Spawn was suppressed by an active per-vault cooldown breadcrumb. The
 * breadcrumb is written elsewhere (BF-347); ensure reads it through the
 * owner-evidence pipeline and surfaces the suppression as a typed error
 * instead of forking another launch attempt.
 */
export class OwnerSpawnCooldownError extends Error {
  constructor(
    public readonly vault: string,
    public readonly untilMs: number,
    public readonly reason: string,
  ) {
    super(
      `daemon spawn for vault ${vault} suppressed by cooldown until ${new Date(untilMs).toISOString()} (${reason})`,
    )
    this.name = 'OwnerSpawnCooldownError'
  }
}

/**
 * Bounded wait timed out before the in-flight owner became healthy.
 * Raised when `decideOwnerAction` keeps returning `wait`
 * (owner-starting / owner-not-ready) past the configured ensure
 * deadline.
 */
export class OwnerWaitTimeoutError extends Error {
  constructor(
    public readonly vault: string,
    public readonly recordedPid: number,
  ) {
    super(
      `daemon owner for vault ${vault} did not become healthy before deadline (pid ${recordedPid})`,
    )
    this.name = 'OwnerWaitTimeoutError'
  }
}
