/**
 * Bounded, non-blocking graceful shutdown.
 *
 * Runs an ordered list of teardown steps where **no single step can
 * prevent the rest from running, or prevent the process from exiting**.
 * Each step is time-boxed: a step that throws OR hangs (an `await` that
 * never resolves) is abandoned after `stepTimeoutMs`, reported via
 * `onStepIssue`, and the next step runs. A hard deadline arms an
 * unconditional `exit` so a pathological teardown can never produce an
 * immortal zombie daemon.
 *
 * This exists because a `try/catch` around a sequence of `await`s does
 * NOT defend against a hang — `catch` only fires on rejection, and an
 * await on a promise that never settles blocks forever. The observed
 * failure mode: a daemon's parent-death watchdog fires shutdown, an early
 * teardown step hangs, the later steps (notably `rpc.port` deletion) and
 * `process.exit` are never reached, and the shutdown latch turns every
 * subsequent SIGTERM into a no-op — leaving a wedged daemon that holds
 * its port and discovery files until SIGKILL.
 *
 * Ordering is preserved (steps run sequentially) because teardown order
 * is load-bearing for some daemons — e.g. deleting `rpc.port` before
 * releasing the owner record, so a reader never sees a live owner record
 * pointing at a stale port. Sequential-with-timeout keeps that order
 * while guaranteeing forward progress.
 *
 * `exit` is injected (production passes `process.exit`) so the runner is
 * testable as a black box without terminating the test process. It is
 * invoked at most once.
 */

export type ShutdownStep = {
  /** Short identifier surfaced in `onStepIssue` diagnostics. */
  readonly label: string
  /** The teardown action. May be sync or async; may throw or hang. */
  readonly run: () => void | Promise<void>
}

export type GracefulShutdownOptions = {
  readonly steps: readonly ShutdownStep[]
  /** Per-step ceiling. A step exceeding this is abandoned; the next runs. */
  readonly stepTimeoutMs: number
  /**
   * Absolute ceiling for the whole sequence. If breached (e.g. the
   * step-timeout machinery itself wedges), `exit(1)` fires regardless of
   * step state. Should exceed `stepTimeoutMs` so normal timed-out steps
   * are not pre-empted by the backstop.
   */
  readonly hardDeadlineMs: number
  /** Reports a step that threw or timed out. Must not throw. */
  readonly onStepIssue: (label: string, error: Error) => void
  /** Terminal process exit. Invoked at most once. */
  readonly exit: (code: number) => void
}

export async function runGracefulShutdown(
  options: GracefulShutdownOptions,
): Promise<void> {
  let exited = false
  const exitOnce = (code: number): void => {
    if (exited) return
    exited = true
    options.exit(code)
  }

  const hardTimer = setTimeout(() => {
    options.onStepIssue(
      '<hard-deadline>',
      new Error(`shutdown exceeded ${options.hardDeadlineMs}ms hard deadline`),
    )
    exitOnce(1)
  }, options.hardDeadlineMs)
  hardTimer.unref?.()

  for (const step of options.steps) {
    if (exited) break
    try {
      await runStep(step, options.stepTimeoutMs)
    } catch (err) {
      options.onStepIssue(step.label, asError(err))
    }
  }

  clearTimeout(hardTimer)
  exitOnce(0)
}

async function runStep(step: ShutdownStep, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`step "${step.label}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    )
    timer.unref?.()
  })
  try {
    await Promise.race([Promise.resolve().then(() => step.run()), timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}
