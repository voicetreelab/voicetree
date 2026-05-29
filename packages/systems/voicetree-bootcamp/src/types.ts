/**
 * Pure types for the voicetree-bootcamp.
 *
 * Behaviour lives in pure functions (scoring.ts) and impure shells
 * (runner.ts, drivers/*.ts). All values here are plain data.
 */

/**
 * One observed `vt` invocation, written as one JSON entry per call by the
 * PATH shim. Canonical source for vtInvocationCount and for per-command
 * scoring evidence.
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
 * A `vt` surface the scenario expects the agent to exercise.
 *
 * verb matches contiguous-subsequence argv words ("graph create" matches
 * `vt graph create --foo bar`).
 *
 * minCount (default 1) lets a scenario require the verb to fire multiple
 * times — e.g. B5 needs `graph lint` ≥2× (regroup + re-lint).
 */
export type CommandPattern = {
    readonly verb: string
    readonly minCount?: number
}

/**
 * Per-command outcome category. Scored via OUTCOME_SCORES and meaned by
 * aggregateScore — kept as the Phase 1 5-tier rubric; later phases may refine.
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

export type CommandAttempt = {
    readonly expected: CommandPattern
    readonly outcome: ScoreOutcome
    readonly evidence: readonly ShimLogEntry[]
}

/**
 * One scenario: workflow + post-state verification.
 *
 * setup(vaultDir) writes fixtures and starts daemons.
 * taskPrompt is handed to the harness verbatim.
 * successCriteria(vaultDir) verifies the post-state.
 * teardown(vaultDir) runs unconditionally in finally{} — used by scenarios
 * that own auxiliary processes (B5 owns vt-graphd).
 */
export type ScenarioSpec = {
    readonly id: string
    readonly name: string
    readonly setup: (vaultDir: string) => Promise<void>
    readonly taskPrompt: string
    readonly expectedCommands: readonly CommandPattern[]
    readonly successCriteria: (vaultDir: string) => Promise<SuccessResult>
    readonly budgets: {
        readonly tokens: number
        readonly toolCalls: number
        readonly vtInvocations: number
        readonly seconds: number
    }
    readonly teardown?: (vaultDir: string) => Promise<void>
}

/**
 * Per-checkpoint result for scenarios that grade independent sub-tasks with
 * partial credit. B7 (knowledge gardening) is the first such scenario: its
 * three ordered checkpoints (bulk-create / regroup / folder-note) are each
 * scored, and the scenario's `passed` is the conjunction.
 */
export type CheckpointResult = {
    readonly name: string
    readonly passed: boolean
    readonly detail: string
}

/**
 * Post-state verification result. `passed`/`detail` remain the binding gate
 * (scoring.ts collapses fitness to 0 on a failing gate). `checkpoints`, when
 * present, surfaces partial-credit detail for multi-stage scenarios — single-
 * gate scenarios (B1–B6) omit it.
 */
export type SuccessResult = {
    readonly passed: boolean
    readonly detail: string
    readonly checkpoints?: readonly CheckpointResult[]
}

/**
 * Settled per-cell telemetry from the harness driver. Harness-symmetric:
 *   inputTokens         settled billed input (incl. cache_creation + cache_read
 *                       on Claude; input + cached_input on Codex).
 *   outputTokens        settled billed output (incl. thinking on Claude;
 *                       reasoning_output_tokens on Codex).
 *   toolCallCount       agent-emitted tool_use blocks across all turns, deduped.
 *                       Supersets vtInvocationCount (includes Bash wrapper calls).
 *   vtInvocationCount   count of shim-log files. Canonical — never parsed from
 *                       the harness stream.
 *   wallClockMs         child spawn → close.
 */
export type RunTelemetry = {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly toolCallCount: number
    readonly vtInvocationCount: number
    readonly wallClockMs: number
}

/**
 * Effort knob exposed at the CLI. Claude Code: native --effort flag. Codex:
 * model-SKU swap (no --effort flag in codex-cli 0.133.0).
 */
export type Effort = 'low' | 'medium' | 'high'

/**
 * Coverage gate: every expected verb appears ≥ minCount times in the shim
 * log, regardless of exitCode.
 */
export type Coverage = {
    readonly passed: boolean
    readonly missingVerbs: readonly string[]
}

/**
 * Composite scoring output. Each efficiency dim is clamped to (EPSILON, 1].
 * fitness = geomean × successGate × coverageGate. A failing binary gate
 * collapses fitness to 0 regardless of efficiency.
 */
export type FitnessBreakdown = {
    readonly correctness: number
    readonly vtEff: number
    readonly tokenEff: number
    readonly toolEff: number
    readonly timeEff: number
    readonly completion: number
    readonly geomean: number
    readonly successGate: 0 | 1
    readonly coverageGate: 0 | 1
    readonly fitness: number
}

/**
 * Harness driver plug-in interface. Two impls land in src/drivers/:
 * claudeCodeDriver (Haiku 4.5 / Sonnet 4.6 / Opus 4.7) and codexDriver.
 * Drivers absorb per-harness churn so the runner stays harness-agnostic.
 *
 * The driver returns telemetry MINUS vtInvocationCount — the runner attaches
 * that from the shim-log file count (canonical source).
 */
export type HarnessDriver = {
    readonly name: 'claude' | 'codex'
    readonly models: readonly string[]
    readonly runScenario: (opts: {
        readonly model: string
        readonly effort: Effort
        readonly prompt: string
        readonly cwd: string
        readonly env: Readonly<Record<string, string>>
        readonly timeoutMs: number
        readonly artifactDir: string
    }) => Promise<{
        readonly transcriptPath: string
        readonly telemetry: Omit<RunTelemetry, 'vtInvocationCount'>
        readonly exitInfo: {
            readonly code: number | null
            readonly signal: NodeJS.Signals | null
        }
    }>
}

/**
 * One (scenario × model × rep) cell result. The contract between scoring
 * and the CLI/report.
 */
export type CellResult = {
    readonly scenarioId: string
    readonly model: string
    readonly rep: number
    readonly telemetry: RunTelemetry
    readonly shimLogPath: string
    readonly transcriptPath: string
    readonly attempts: readonly CommandAttempt[]
    readonly success: SuccessResult
    readonly coverage: Coverage
    readonly breakdown: FitnessBreakdown
}
