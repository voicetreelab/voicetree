/**
 * Pure scoring functions.
 *
 * Phase 1: implements the first-try-correct / retry-after-failure / abandoned
 * outcomes deterministically from the shim log. `help-then-correct` and
 * `wrong-command-succeeded` are stubbed (always 'abandoned' if no success;
 * later phases will discriminate help-reads and post-state bypasses).
 *
 * Phase 4 will expand this to the full 5-tier rubric.
 */
import type {
    CommandAttempt,
    CommandPattern,
    Coverage,
    FitnessBreakdown,
    RunTelemetry,
    ScenarioSpec,
    ScoreOutcome,
    ShimLogEntry,
    SuccessResult,
} from './types.ts'
import {OUTCOME_SCORES} from './types.ts'
import {matchesVerb} from './shim-log.ts'

/**
 * Floor for the efficiency dims feeding the weighted geomean. A literal 0
 * would collapse every other dim's contribution; the success / coverage
 * gates already encode "did nothing" correctly.
 */
export const EPSILON = 1e-6

const FITNESS_WEIGHTS = {
    correctness: 1,
    vtEff: 2,
    tokenEff: 1,
    toolEff: 1,
    timeEff: 1,
    completion: 1,
} as const

/**
 * Score one expected command against the shim log. Walks invocations in
 * order, finds the first matching the verb, and classifies based on whether
 * it succeeded and whether earlier non-matching invocations preceded it.
 */
export function scoreCommand(
    expected: CommandPattern,
    shimLog: readonly ShimLogEntry[]
): CommandAttempt {
    const matching = shimLog.filter((entry) => matchesVerb(entry, expected.verb))

    if (matching.length === 0) {
        return {
            expected,
            outcome: 'abandoned',
            evidence: [],
        }
    }

    const firstMatch = matching[0]
    const successful = matching.find((entry) => entry.exitCode === 0)

    if (firstMatch.exitCode === 0) {
        return {
            expected,
            outcome: 'first-try-correct',
            evidence: [firstMatch],
        }
    }

    if (successful !== undefined) {
        return {
            expected,
            outcome: 'retry-after-failure',
            evidence: matching.slice(0, matching.indexOf(successful) + 1),
        }
    }

    return {
        expected,
        outcome: 'abandoned',
        evidence: matching,
    }
}

/**
 * Score a scenario by scoring each expected command and taking the mean.
 */
export function scoreScenario(
    expectedCommands: readonly CommandPattern[],
    shimLog: readonly ShimLogEntry[]
): {readonly attempts: readonly CommandAttempt[]; readonly meanScore: number} {
    const attempts = expectedCommands.map((cmd) => scoreCommand(cmd, shimLog))
    const meanScore = aggregateScore(attempts)
    return {attempts, meanScore}
}

/**
 * Mean of per-attempt scores. Empty attempts → 0 (nothing to test = failed).
 */
export function aggregateScore(attempts: readonly CommandAttempt[]): number {
    if (attempts.length === 0) return 0
    const total = attempts.reduce((sum, a) => sum + scoreFor(a.outcome), 0)
    return total / attempts.length
}

export function scoreFor(outcome: ScoreOutcome): number {
    return OUTCOME_SCORES[outcome]
}

/**
 * One efficiency dim: budget over actual, clamped to (EPSILON, 1]. actual ≤ 0
 * means no work was attempted — that case belongs to the gates, not this dim,
 * so return 1 (no penalty here).
 */
export function computeEfficiencyDim(budget: number, actual: number): number {
    if (actual <= 0) return 1
    const ratio = budget / actual
    if (ratio >= 1) return 1
    if (ratio <= EPSILON) return EPSILON
    return ratio
}

/**
 * Fraction of shim-log entries that exited cleanly. Empty log → 0 (the
 * coverage gate will already be failing in that case).
 */
export function computeCompletion(shimLog: readonly ShimLogEntry[]): number {
    const total = shimLog.length
    if (total === 0) return 0
    const failed = shimLog.reduce((n, e) => (e.exitCode !== 0 ? n + 1 : n), 0)
    return 1 - failed / total
}

/**
 * Coverage gate: every expected verb appears in the shim log ≥ minCount
 * times (minCount defaults to 1). Exit code is irrelevant — the gate asks
 * "did the agent exercise this surface at all?".
 */
export function computeCoverage(
    expected: readonly CommandPattern[],
    shimLog: readonly ShimLogEntry[]
): Coverage {
    const missingVerbs: string[] = []
    for (const pattern of expected) {
        const required = pattern.minCount ?? 1
        const seen = shimLog.reduce(
            (n, entry) => (matchesVerb(entry, pattern.verb) ? n + 1 : n),
            0
        )
        if (seen < required) missingVerbs.push(pattern.verb)
    }
    return {passed: missingVerbs.length === 0, missingVerbs}
}

/**
 * Σ-weighted geometric mean: (Π v_i^w_i)^(1/Σw_i). Computed in log space
 * to avoid floating-point underflow when many sub-EPSILON values multiply.
 * Callers pre-clamp inputs above EPSILON; values ≤ 0 are not supported.
 */
export function weightedGeomean(
    values: readonly number[],
    weights: readonly number[]
): number {
    if (values.length === 0) throw new Error('weightedGeomean: empty input')
    if (values.length !== weights.length) {
        throw new Error(
            `weightedGeomean: length mismatch (${values.length} values vs ${weights.length} weights)`
        )
    }
    let weightedLogSum = 0
    let weightSum = 0
    for (let i = 0; i < values.length; i++) {
        weightedLogSum += weights[i] * Math.log(values[i])
        weightSum += weights[i]
    }
    return Math.exp(weightedLogSum / weightSum)
}

/**
 * Full fitness composition. Six dims feed a weighted geomean (vt_eff carries
 * double weight — the dim we directly control); two binary gates (success,
 * coverage) multiply the geomean. A failing gate collapses fitness to 0 while
 * leaving every dim visible in the breakdown for remediation reports.
 */
export function computeFitness(input: {
    readonly attempts: readonly CommandAttempt[]
    readonly shimLog: readonly ShimLogEntry[]
    readonly expected: readonly CommandPattern[]
    readonly telemetry: RunTelemetry
    readonly budgets: ScenarioSpec['budgets']
    readonly success: SuccessResult
}): FitnessBreakdown {
    const {attempts, shimLog, expected, telemetry, budgets, success} = input

    const correctness = clampToUnit(aggregateScore(attempts))
    const vtEff = computeEfficiencyDim(budgets.vtInvocations, telemetry.vtInvocationCount)
    const tokenEff = computeEfficiencyDim(
        budgets.tokens,
        telemetry.inputTokens + telemetry.outputTokens
    )
    const toolEff = computeEfficiencyDim(budgets.toolCalls, telemetry.toolCallCount)
    const timeEff = computeEfficiencyDim(budgets.seconds, telemetry.wallClockMs / 1000)
    const completion = clampToUnit(computeCompletion(shimLog))

    const geomean = weightedGeomean(
        [correctness, vtEff, tokenEff, toolEff, timeEff, completion],
        [
            FITNESS_WEIGHTS.correctness,
            FITNESS_WEIGHTS.vtEff,
            FITNESS_WEIGHTS.tokenEff,
            FITNESS_WEIGHTS.toolEff,
            FITNESS_WEIGHTS.timeEff,
            FITNESS_WEIGHTS.completion,
        ]
    )

    const coverage = computeCoverage(expected, shimLog)
    const successGate: 0 | 1 = success.passed ? 1 : 0
    const coverageGate: 0 | 1 = coverage.passed ? 1 : 0

    return {
        correctness,
        vtEff,
        tokenEff,
        toolEff,
        timeEff,
        completion,
        geomean,
        successGate,
        coverageGate,
        fitness: geomean * successGate * coverageGate,
    }
}

function clampToUnit(value: number): number {
    if (value >= 1) return 1
    if (value <= EPSILON) return EPSILON
    return value
}
