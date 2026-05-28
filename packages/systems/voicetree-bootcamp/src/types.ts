/**
 * Pure types for the CLI ergonomics bootcamp.
 *
 * All values are plain data — no methods, no classes. Behaviour lives in
 * pure functions (scoring.ts, shim-log.ts) and the impure runner (runner.ts).
 */

/**
 * One scenario: a realistic VoiceTree workflow that an LLM agent must complete
 * using `vt`. Composed of a working-dir setup, a natural-language task prompt,
 * the CLI surfaces that must be exercised (for coverage assertion), and an
 * observable post-state check.
 */
export type ScenarioSpec = {
    readonly id: string                         // e.g. "S9"
    readonly name: string                       // human-readable
    readonly setup: (vaultDir: string) => Promise<void>
    readonly taskPrompt: string                 // given to the agent verbatim
    readonly expectedCommands: readonly CommandPattern[]
    readonly successCriteria: (vaultDir: string) => Promise<SuccessResult>
}

/**
 * A CLI surface the scenario expects the agent to exercise. Used for the
 * coverage assertion and for per-command scoring.
 *
 * `verb` matches against the joined argv positional words (e.g. "graph create"
 * matches `vt graph create ...`).
 */
export type CommandPattern = {
    readonly verb: string
}

export type SuccessResult = {
    readonly passed: boolean
    readonly detail: string
}

/**
 * One observed `vt` invocation, written to a JSONL log by the PATH-shim.
 * Each entry corresponds to one exec of the shim — argv excludes the shim
 * itself (so argv[0] is `graph`, argv[1] is `create`, etc.).
 */
export type ShimLogEntry = {
    readonly timestampMs: number
    readonly argv: readonly string[]
    readonly cwd: string
    readonly exitCode: number
    readonly stderr: string
    readonly durationMs: number
}

/**
 * Outcome categories from the scoring rubric. Phase 1 collapses everything
 * non-first-try into `other`; later phases expand to the full 5-tier rubric.
 */
export type ScoreOutcome =
    | 'first-try-correct'
    | 'help-then-correct'
    | 'retry-after-failure'
    | 'abandoned'
    | 'wrong-command-succeeded'

export const OUTCOME_SCORES: Readonly<Record<ScoreOutcome, number>> = {
    'first-try-correct': 1.0,
    'help-then-correct': 0.7,
    'retry-after-failure': 0.4,
    'abandoned': 0.0,
    'wrong-command-succeeded': 0.0,
}

/**
 * One scenario × model run.
 */
export type RunResult = {
    readonly scenarioId: string
    readonly model: string
    readonly attempts: readonly CommandAttempt[]
    readonly meanScore: number
    readonly success: SuccessResult
    readonly shimLogDir: string        // directory of per-call .json files
    readonly transcriptPath: string
}

export type CommandAttempt = {
    readonly expected: CommandPattern
    readonly outcome: ScoreOutcome
    readonly evidence: readonly ShimLogEntry[]    // entries that drove the outcome
}
