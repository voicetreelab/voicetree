import {describe, expect, it} from 'vitest'
import {
    aggregateScore,
    computeCompletion,
    computeCorrectness,
    computeCoverage,
    computeEfficiencyDim,
    computeFitness,
    EPSILON,
    scoreCommand,
    scoreScenario,
    weightedGeomean,
} from '../src/scoring.ts'
import type {
    CommandAttempt,
    CommandPattern,
    RunTelemetry,
    ScenarioSpec,
    ShimLogEntry,
    SuccessResult,
} from '../src/types.ts'

const GRAPH_CREATE: CommandPattern = {verb: 'graph create'}
const GRAPH_STRUCTURE: CommandPattern = {verb: 'graph structure'}

function entry(overrides: Partial<ShimLogEntry> = {}): ShimLogEntry {
    return {
        timestampMs: 0,
        argv: ['graph', 'create'],
        cwd: '/tmp',
        exitCode: 0,
        stderr: '',
        durationMs: 10,
        ...overrides,
    }
}

describe('scoreCommand', () => {
    it('returns first-try-correct when the first matching invocation succeeds', () => {
        const log = [entry({argv: ['graph', 'create', '--filename', 'x.md']})]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('first-try-correct')
    })

    it('returns retry-after-failure when first fails but a later one succeeds', () => {
        const log = [
            entry({argv: ['graph', 'create'], exitCode: 1, stderr: 'missing arg'}),
            entry({argv: ['graph', 'create', '--filename', 'x.md'], exitCode: 0}),
        ]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('retry-after-failure')
    })

    it('returns abandoned when no invocation succeeds', () => {
        const log = [
            entry({argv: ['graph', 'create'], exitCode: 1}),
            entry({argv: ['graph', 'create'], exitCode: 2}),
        ]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('abandoned')
    })

    it('returns abandoned when no invocation matches the verb at all', () => {
        const log = [entry({argv: ['graph', 'structure']})]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('abandoned')
        expect(attempt.evidence).toEqual([])
    })

    it('ignores flag arguments when matching the verb', () => {
        const log = [entry({argv: ['--port', '4001', 'graph', 'create']})]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('first-try-correct')
    })

    it('does not match a longer verb against a shorter argv prefix', () => {
        const log = [entry({argv: ['graph']})]
        const attempt = scoreCommand(GRAPH_CREATE, log)
        expect(attempt.outcome).toBe('abandoned')
    })
})

describe('scoreScenario', () => {
    it('averages per-command scores', () => {
        const log = [
            entry({argv: ['graph', 'create'], exitCode: 0}),
            entry({argv: ['graph', 'structure'], exitCode: 1}),
        ]
        const {meanScore, attempts} = scoreScenario([GRAPH_CREATE, GRAPH_STRUCTURE], log)
        expect(attempts).toHaveLength(2)
        expect(attempts[0].outcome).toBe('first-try-correct')
        expect(attempts[1].outcome).toBe('abandoned')
        expect(meanScore).toBeCloseTo(0.5)
    })

    it('returns 0 when no commands are expected', () => {
        expect(aggregateScore([])).toBe(0)
    })
})

const BUDGETS: ScenarioSpec['budgets'] = {
    tokens: 10_000,
    toolCalls: 20,
    vtInvocations: 5,
    seconds: 60,
}

function attempt(verb: string, outcome: CommandAttempt['outcome']): CommandAttempt {
    return {expected: {verb}, outcome, evidence: []}
}

function ok(verb: string): ShimLogEntry {
    return entry({argv: verb.split(/\s+/), exitCode: 0})
}

function passedSuccess(): SuccessResult {
    return {passed: true, detail: 'ok'}
}

function failedSuccess(): SuccessResult {
    return {passed: false, detail: 'post-state mismatch'}
}

describe('computeEfficiencyDim', () => {
    it('returns 1 when actual is 0 (no work attempted — gates handle that)', () => {
        expect(computeEfficiencyDim(10, 0)).toBe(1)
    })

    it('caps at 1 when under budget', () => {
        expect(computeEfficiencyDim(10, 5)).toBe(1)
    })

    it('returns budget/actual when over budget', () => {
        expect(computeEfficiencyDim(10, 20)).toBeCloseTo(0.5)
    })

    it('floors at EPSILON for catastrophic overshoot', () => {
        expect(computeEfficiencyDim(1, 1e12)).toBe(EPSILON)
    })
})

describe('computeCompletion', () => {
    it('returns 1 when every entry exited 0', () => {
        expect(computeCompletion([ok('graph create'), ok('graph structure')])).toBe(1)
    })

    it('returns 0 when shim log is empty', () => {
        expect(computeCompletion([])).toBe(0)
    })

    it('returns 1 - failed/total for mixed exit codes', () => {
        const log = [
            entry({argv: ['graph', 'create'], exitCode: 0}),
            entry({argv: ['graph', 'create'], exitCode: 1}),
            entry({argv: ['graph', 'create'], exitCode: 0}),
            entry({argv: ['graph', 'create'], exitCode: 2}),
        ]
        expect(computeCompletion(log)).toBeCloseTo(0.5)
    })
})

describe('computeCoverage', () => {
    it('passes when every expected verb appears', () => {
        const cov = computeCoverage(
            [{verb: 'graph create'}, {verb: 'graph structure'}],
            [ok('graph create'), ok('graph structure')]
        )
        expect(cov.passed).toBe(true)
        expect(cov.missingVerbs).toEqual([])
    })

    it('reports missing verbs', () => {
        const cov = computeCoverage(
            [{verb: 'graph create'}, {verb: 'graph lint'}],
            [ok('graph create')]
        )
        expect(cov.passed).toBe(false)
        expect(cov.missingVerbs).toEqual(['graph lint'])
    })

    it('respects minCount > 1', () => {
        const cov = computeCoverage(
            [{verb: 'graph lint', minCount: 2}],
            [ok('graph lint')]
        )
        expect(cov.passed).toBe(false)
        expect(cov.missingVerbs).toEqual(['graph lint'])
    })

    it('counts even failed invocations toward coverage', () => {
        const cov = computeCoverage(
            [{verb: 'graph create'}],
            [entry({argv: ['graph', 'create'], exitCode: 1})]
        )
        expect(cov.passed).toBe(true)
    })
})

describe('weightedGeomean', () => {
    it('reduces to the regular geomean when weights are equal', () => {
        const v = [0.5, 0.5, 0.5]
        expect(weightedGeomean(v, [1, 1, 1])).toBeCloseTo(0.5)
    })

    it('applies weights — doubled weight is equivalent to listing twice', () => {
        const a = weightedGeomean([0.5, 0.25], [2, 1])
        const b = weightedGeomean([0.5, 0.5, 0.25], [1, 1, 1])
        expect(a).toBeCloseTo(b)
    })

    it('throws on empty input', () => {
        expect(() => weightedGeomean([], [])).toThrow()
    })

    it('throws on length mismatch', () => {
        expect(() => weightedGeomean([0.5, 0.5], [1])).toThrow()
    })
})

describe('computeFitness — black-box acceptance', () => {
    const ALL_FOUR: readonly CommandPattern[] = [
        {verb: 'graph create'},
        {verb: 'graph structure'},
        {verb: 'graph lint'},
        {verb: 'graph link'},
    ]

    function fullCoverageLog(): readonly ShimLogEntry[] {
        return [
            ok('graph create'),
            ok('graph structure'),
            ok('graph lint'),
            ok('graph link'),
        ]
    }

    function perfectTelemetry(): RunTelemetry {
        return {
            inputTokens: 4_000,
            outputTokens: 4_000,
            toolCallCount: 15,
            vtInvocationCount: 4,
            wallClockMs: 30_000,
        }
    }

    it('all-perfect: fitness = 1.0 when every dim is at or under budget', () => {
        const breakdown = computeFitness({
            attempts: ALL_FOUR.map((p) => attempt(p.verb, 'first-try-correct')),
            shimLog: fullCoverageLog(),
            expected: ALL_FOUR,
            telemetry: perfectTelemetry(),
            budgets: BUDGETS,
            success: passedSuccess(),
        })
        expect(breakdown.fitness).toBeCloseTo(1.0, 5)
        expect(breakdown.geomean).toBeCloseTo(1.0, 5)
        expect(breakdown.successGate).toBe(1)
        expect(breakdown.coverageGate).toBe(1)
    })

    it('vt_eff 10× over budget, others 0.95: fitness lands well below T=0.7', () => {
        // Aim each non-vt dim at exactly 0.95 so the worked geomean is reproducible.
        const breakdown = computeFitness({
            // correctness: mix of outcomes to land at 0.95 — one help-then-correct
            // (0.7) mixed with first-try-correct cells doesn't give 0.95 cleanly,
            // so use a 20-cell synthetic batch: 19 perfect + 1 at 0.05 → 0.9525.
            // Simpler: 95 perfect, 5 abandoned — but we control via direct attempts.
            attempts: Array.from({length: 20}, (_, i) =>
                attempt('graph create', i < 19 ? 'first-try-correct' : 'retry-after-failure')
            ),
            // shimLog: 100 entries with 5 failures → completion = 0.95.
            shimLog: [
                ...Array.from({length: 95}, () =>
                    entry({argv: ['graph', 'create'], exitCode: 0})
                ),
                ...Array.from({length: 5}, () =>
                    entry({argv: ['graph', 'create'], exitCode: 1})
                ),
            ],
            expected: [{verb: 'graph create'}],
            telemetry: {
                inputTokens: BUDGETS.tokens / 2 / 0.95,
                outputTokens: BUDGETS.tokens / 2 / 0.95,
                toolCallCount: BUDGETS.toolCalls / 0.95,
                vtInvocationCount: BUDGETS.vtInvocations * 10, // 10× over
                wallClockMs: (BUDGETS.seconds / 0.95) * 1000,
            },
            budgets: BUDGETS,
            success: passedSuccess(),
        })
        // correctness = (19·1 + 1·0.4)/20 = 0.97 ≠ 0.95 — close enough to the worked
        // intent (single weak dim). Verify the dim shapes and the inequality bands.
        expect(breakdown.vtEff).toBeCloseTo(0.1, 5)
        expect(breakdown.tokenEff).toBeCloseTo(0.95, 2)
        expect(breakdown.toolEff).toBeCloseTo(0.95, 2)
        expect(breakdown.timeEff).toBeCloseTo(0.95, 2)
        expect(breakdown.completion).toBeCloseTo(0.95, 5)
        expect(breakdown.fitness).toBeLessThan(0.7)
        expect(breakdown.fitness).toBeGreaterThan(0.45)
        expect(breakdown.fitness).toBeLessThan(0.56)
    })

    it('token_eff 10× over, others 0.95: ~13pp+ gap vs vt_eff blowout', () => {
        const tokenBlowout = computeFitness({
            attempts: Array.from({length: 20}, (_, i) =>
                attempt('graph create', i < 19 ? 'first-try-correct' : 'retry-after-failure')
            ),
            shimLog: [
                ...Array.from({length: 95}, () =>
                    entry({argv: ['graph', 'create'], exitCode: 0})
                ),
                ...Array.from({length: 5}, () =>
                    entry({argv: ['graph', 'create'], exitCode: 1})
                ),
            ],
            expected: [{verb: 'graph create'}],
            telemetry: {
                inputTokens: BUDGETS.tokens * 10 / 2, // 10× over budget
                outputTokens: BUDGETS.tokens * 10 / 2,
                toolCallCount: BUDGETS.toolCalls / 0.95,
                vtInvocationCount: BUDGETS.vtInvocations / 0.95,
                wallClockMs: (BUDGETS.seconds / 0.95) * 1000,
            },
            budgets: BUDGETS,
            success: passedSuccess(),
        })
        expect(tokenBlowout.tokenEff).toBeCloseTo(0.1, 5)
        expect(tokenBlowout.vtEff).toBeCloseTo(0.95, 2)
        // Weight-1 dim blowout — bounded around the plan's worked ~0.65.
        expect(tokenBlowout.fitness).toBeGreaterThan(0.55)
        expect(tokenBlowout.fitness).toBeLessThan(0.75)

        // The double weight on vt_eff is the WHY: blowing vt_eff should hurt
        // measurably more than blowing a weight-1 dim. Recompute the vt blowout
        // with identical other dims for an apples-to-apples gap check.
        const vtBlowout = computeFitness({
            attempts: Array.from({length: 20}, (_, i) =>
                attempt('graph create', i < 19 ? 'first-try-correct' : 'retry-after-failure')
            ),
            shimLog: [
                ...Array.from({length: 95}, () =>
                    entry({argv: ['graph', 'create'], exitCode: 0})
                ),
                ...Array.from({length: 5}, () =>
                    entry({argv: ['graph', 'create'], exitCode: 1})
                ),
            ],
            expected: [{verb: 'graph create'}],
            telemetry: {
                inputTokens: BUDGETS.tokens / 2 / 0.95,
                outputTokens: BUDGETS.tokens / 2 / 0.95,
                toolCallCount: BUDGETS.toolCalls / 0.95,
                vtInvocationCount: BUDGETS.vtInvocations * 10,
                wallClockMs: (BUDGETS.seconds / 0.95) * 1000,
            },
            budgets: BUDGETS,
            success: passedSuccess(),
        })
        expect(tokenBlowout.fitness - vtBlowout.fitness).toBeGreaterThan(0.13)
    })

    it('one abandoned command (of 4): smooth response, fitness > 0.9 and < 1', () => {
        const breakdown = computeFitness({
            attempts: [
                attempt('graph create', 'first-try-correct'),
                attempt('graph structure', 'first-try-correct'),
                attempt('graph lint', 'first-try-correct'),
                attempt('graph link', 'abandoned'),
            ],
            shimLog: fullCoverageLog(),
            expected: ALL_FOUR,
            telemetry: perfectTelemetry(),
            budgets: BUDGETS,
            success: passedSuccess(),
        })
        expect(breakdown.correctness).toBeCloseTo(0.75, 5)
        expect(breakdown.fitness).toBeLessThan(1.0)
        expect(breakdown.fitness).toBeGreaterThan(0.9)
    })

    it('success gate fails, coverage passes: fitness = 0; all dims still visible', () => {
        const breakdown = computeFitness({
            attempts: ALL_FOUR.map((p) => attempt(p.verb, 'first-try-correct')),
            shimLog: fullCoverageLog(),
            expected: ALL_FOUR,
            telemetry: perfectTelemetry(),
            budgets: BUDGETS,
            success: failedSuccess(),
        })
        expect(breakdown.fitness).toBe(0)
        expect(breakdown.successGate).toBe(0)
        expect(breakdown.coverageGate).toBe(1)
        // Every dim must still surface non-zero for the remediation report.
        expect(breakdown.correctness).toBeGreaterThan(0)
        expect(breakdown.vtEff).toBeGreaterThan(0)
        expect(breakdown.tokenEff).toBeGreaterThan(0)
        expect(breakdown.toolEff).toBeGreaterThan(0)
        expect(breakdown.timeEff).toBeGreaterThan(0)
        expect(breakdown.completion).toBeGreaterThan(0)
        expect(breakdown.geomean).toBeGreaterThan(0)
    })

    it('coverage gate fails (missing verb): fitness = 0; missingVerbs lists it', () => {
        const breakdown = computeFitness({
            attempts: ALL_FOUR.map((p) => attempt(p.verb, 'first-try-correct')),
            shimLog: [ok('graph create'), ok('graph structure'), ok('graph lint')],
            expected: ALL_FOUR,
            telemetry: perfectTelemetry(),
            budgets: BUDGETS,
            success: passedSuccess(),
        })
        expect(breakdown.fitness).toBe(0)
        expect(breakdown.coverageGate).toBe(0)
        expect(breakdown.successGate).toBe(1)
        const coverage = computeCoverage(ALL_FOUR, [
            ok('graph create'),
            ok('graph structure'),
            ok('graph lint'),
        ])
        expect(coverage.missingVerbs).toEqual(['graph link'])
    })
})

describe('computeCorrectness', () => {
    it('matches OUTCOME_SCORES mean', () => {
        const attempts = [
            attempt('graph create', 'first-try-correct'),
            attempt('graph structure', 'retry-after-failure'),
        ]
        expect(computeCorrectness(attempts)).toBeCloseTo((1.0 + 0.4) / 2)
    })

    it('returns 0 on empty input', () => {
        expect(computeCorrectness([])).toBe(0)
    })
})
