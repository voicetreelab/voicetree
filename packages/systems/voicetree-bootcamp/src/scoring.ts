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
import type {CommandAttempt, CommandPattern, ScoreOutcome, ShimLogEntry} from './types.ts'
import {OUTCOME_SCORES} from './types.ts'
import {matchesVerb} from './shim-log.ts'

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
