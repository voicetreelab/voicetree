import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {describe, expect, it} from 'vitest'

import {runTierBudgetGate, type EvaluationResult} from '../../../../scripts/check-tier-budgets.ts'

type ReportInput = {
    checkId: string
    startedAt: string
    endedAt: string
    durationMs?: number
    status?: 'pass' | 'fail' | 'skip'
    measurePath?: string
    jobId?: string
}

type BudgetInput = {wallClockMs: number; sumMs: number | null; perCheckMaxRatio: number}

async function withFixture<T>(
    reports: readonly ReportInput[],
    budgets: Record<number, BudgetInput>,
    body: (opts: {reportsDir: string; timingBudgetsDir: string; resultFile: string}) => Promise<T>,
): Promise<T> {
    const root = await mkdtemp(join(tmpdir(), 'timing-gate-fixture-'))
    const reportsDir = join(root, 'reports')
    const timingBudgetsDir = join(root, 'timing')
    const resultFile = join(root, 'result.json')
    await mkdir(reportsDir, {recursive: true})
    await mkdir(timingBudgetsDir, {recursive: true})
    for (const r of reports) {
        const durationMs = r.durationMs ?? Date.parse(r.endedAt) - Date.parse(r.startedAt)
        const measurePath = r.measurePath ?? `packages/measures/src/checks/tier_1/x/${r.checkId}.ts`
        await writeFile(join(reportsDir, `${r.checkId}.json`), JSON.stringify({
            checkId: r.checkId,
            checkName: r.checkId,
            category: 'Unit',
            command: r.checkId,
            status: r.status ?? 'pass',
            durationMs,
            startedAt: r.startedAt,
            endedAt: r.endedAt,
            timestamp: r.endedAt,
            details: {measurePath, ...(r.jobId ? {jobId: r.jobId} : {})},
        }), 'utf8')
    }
    for (const [tierStr, budget] of Object.entries(budgets)) {
        await writeFile(join(timingBudgetsDir, `tier_${tierStr}.json`),
            `${JSON.stringify(budget, null, 2)}\n`, 'utf8')
    }
    try {
        return await body({reportsDir, timingBudgetsDir, resultFile})
    } finally {
        await rm(root, {recursive: true, force: true})
    }
}

function tierTiming(result: EvaluationResult, tier: number) {
    const t = result.tierTimings.find(t => t.tier === tier)
    if (!t) throw new Error(`tier_${tier} not in result: ${JSON.stringify(result.tiersEvaluated)}`)
    return t
}

const TIER_1_BUDGET: BudgetInput = {wallClockMs: 5_000, sumMs: 10_000, perCheckMaxRatio: 0.5}

describe('runTierBudgetGate — wall-clock aggregation', () => {
    it('collapses checks with no jobId (local single-process runs) into one tier-wide span', async () => {
        await withFixture([
            {checkId: 'a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:05.000Z'},
            {checkId: 'b', startedAt: '2026-01-01T00:00:02.000Z', endedAt: '2026-01-01T00:00:10.000Z'},
        ], {1: {wallClockMs: 30_000, sumMs: 30_000, perCheckMaxRatio: 0.99}}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(0)
            const t = tierTiming(result, 1)
            expect(t.wallClockMs).toBe(10_000)
            expect(t.sumMs).toBe(13_000) // 5s + 8s
            expect(t.checkCount).toBe(2)
            expect(t.slowest).toEqual({checkId: 'b', durationMs: 8_000})
        })
    })

    it('takes the max per-job span — runner provisioning skew between parallel jobs does not count', async () => {
        // Two parallel jobs on separate runners. Job A did 8s of work; job B's
        // runner was slow to provision, so its 4s of work happened 35s later. The
        // real wall-clock is the slowest single job (8s), NOT the 39s global span
        // — the gap between independently scheduled runners is not work.
        await withFixture([
            {checkId: 'a1', jobId: 'job-a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:08.000Z'},
            {checkId: 'b1', jobId: 'job-b', startedAt: '2026-01-01T00:00:35.000Z', endedAt: '2026-01-01T00:00:39.000Z'},
        ], {1: {wallClockMs: 30_000, sumMs: 30_000, perCheckMaxRatio: 0.99}}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(0)
            const t = tierTiming(result, 1)
            expect(t.wallClockMs).toBe(8_000) // max per-job span, not 39_000
            expect(t.sumMs).toBe(12_000) // 8s + 4s, tier-global
            expect(t.slowest).toEqual({checkId: 'a1', durationMs: 8_000})
        })
    })

    it("a job's span covers all its own sequential checks (min-start to max-end within the job)", async () => {
        // Job A runs two checks back-to-back (0–3s, 3–9s) → 9s span. Job B runs a
        // single 5s check. Tier wall-clock = max(9s, 5s) = 9s.
        await withFixture([
            {checkId: 'a1', jobId: 'job-a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:03.000Z'},
            {checkId: 'a2', jobId: 'job-a', startedAt: '2026-01-01T00:00:03.000Z', endedAt: '2026-01-01T00:00:09.000Z'},
            {checkId: 'b1', jobId: 'job-b', startedAt: '2026-01-01T00:00:01.000Z', endedAt: '2026-01-01T00:00:06.000Z'},
        ], {1: {wallClockMs: 30_000, sumMs: 30_000, perCheckMaxRatio: 0.99}}, async (opts) => {
            const {result} = await runTierBudgetGate(opts)
            expect(tierTiming(result, 1).wallClockMs).toBe(9_000)
        })
    })

    it('groups reports by tier and accepts tier folders with suffixes', async () => {
        await withFixture([
            {checkId: 'a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z',
                measurePath: 'packages/measures/src/checks/tier_0_pre_commit/lint/a.ts'},
            {checkId: 'b', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:02.000Z',
                measurePath: 'packages/measures/src/checks/tier_2/x/b.ts'},
            {checkId: 'c', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:03.000Z',
                measurePath: 'packages/measures/src/health/meta/c.ts'},
        ], {
            0: TIER_1_BUDGET, 2: TIER_1_BUDGET,
        }, async (opts) => {
            const {result} = await runTierBudgetGate(opts)
            expect([...result.tiersEvaluated]).toEqual([0, 2])
            expect(tierTiming(result, 0).wallClockMs).toBe(1_000)
            expect(tierTiming(result, 2).wallClockMs).toBe(2_000)
        })
    })

    it('excludes skipped checks from aggregation', async () => {
        await withFixture([
            {checkId: 'a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:10.000Z'},
            {checkId: 'b', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:20.000Z', status: 'skip'},
        ], {1: {wallClockMs: 60_000, sumMs: 60_000, perCheckMaxRatio: 0.99}}, async (opts) => {
            const {result} = await runTierBudgetGate(opts)
            const t = tierTiming(result, 1)
            expect(t.checkCount).toBe(1)
            expect(t.slowest?.checkId).toBe('a')
        })
    })

    it("filters out the gate's own report so it never gates against its own duration", async () => {
        await withFixture([
            {checkId: 'tier-time-budget-gate', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:30.000Z',
                measurePath: 'packages/measures/src/checks/tier_4/perf/timing-budget-gate.ts'},
        ], {4: {wallClockMs: 5_000, sumMs: 5_000, perCheckMaxRatio: 0.5}}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(0)
            expect(result.tiersEvaluated).toEqual([])
        })
    })
})

describe('runTierBudgetGate — budget evaluation', () => {
    it('exits 0 when every tier is within wall-clock and sum budget', async () => {
        await withFixture([
            {checkId: 'a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z'},
        ], {1: TIER_1_BUDGET}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(0)
            expect(result.breaches).toEqual([])
            expect(result.tiersEvaluated).toEqual([1])
        })
    })

    it('reports a wall-clock breach when max-end minus min-start exceeds the budget', async () => {
        await withFixture([
            {checkId: 'a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:06.000Z', durationMs: 1_000},
        ], {1: TIER_1_BUDGET}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(1)
            expect(result.breaches).toEqual([{
                tier: 1, kind: 'wallClock',
                observedMs: 6_000, budgetMs: 5_000, ratio: 1.2,
            }])
        })
    })

    it('reports a sum breach when sum-of-durations exceeds budget even if wall-clock fits', async () => {
        // Three checks running in parallel for 4s each — wall-clock 4s (fits 5s),
        // sum 12s (busts 10s).
        await withFixture([
            {checkId: 'a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:04.000Z'},
            {checkId: 'b', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:04.000Z'},
            {checkId: 'c', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:04.000Z'},
        ], {1: TIER_1_BUDGET}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(1)
            expect(result.breaches.map(b => b.kind)).toEqual(['sum'])
        })
    })

    it('skips sum check when tier budget sumMs is null (e.g. tier_4)', async () => {
        await withFixture([
            {checkId: 'a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:05.000Z', durationMs: 100_000,
                measurePath: 'packages/measures/src/checks/tier_4/x/a.ts'},
        ], {4: {wallClockMs: 10_000, sumMs: null, perCheckMaxRatio: 0.6}}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(0)
            expect(result.breaches).toEqual([])
        })
    })

    it('emits a per-check warning when the slowest check exceeds perCheckMaxRatio of wall-clock budget', async () => {
        await withFixture([
            {checkId: 'big', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:03.000Z'},
        ], {1: TIER_1_BUDGET}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(0)
            expect(result.perCheckWarnings).toEqual([{
                tier: 1, checkId: 'big', durationMs: 3_000, ratio: 3_000 / 5_000,
            }])
        })
    })

    it('ignores tiers that have reports but no budget', async () => {
        await withFixture([
            {checkId: 'a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:60.000Z',
                measurePath: 'packages/measures/src/checks/tier_99/x/a.ts'},
        ], {1: TIER_1_BUDGET}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(0)
            expect(result.tiersEvaluated).toEqual([])
            expect(result.breaches).toEqual([])
        })
    })
})

describe('runTierBudgetGate — branch-aware CI integrity', () => {
    it('fails when a required upstream generated job did not succeed', async () => {
        await withFixture([
            {checkId: 'a', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z'},
        ], {1: TIER_1_BUDGET}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate({
                ...opts,
                baseRef: 'dev',
                needsJson: JSON.stringify({'tier-1-unit': {result: 'failure'}}),
                requiredJobsByBaseRefJson: JSON.stringify({dev: ['tier-1-unit', 'budget-gate']}),
            })
            expect(exitCode).toBe(1)
            expect(result.ciFailures).toEqual([{
                kind: 'required-job',
                jobId: 'tier-1-unit',
                message: 'required job tier-1-unit for dev finished with failure',
            }])
        })
    })

    it('fails when a required tier produced no reports even if its job succeeded', async () => {
        await withFixture([], {2: TIER_1_BUDGET}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate({
                ...opts,
                baseRef: 'dev',
                needsJson: JSON.stringify({'tier-2-unit': {result: 'success'}}),
                requiredJobsByBaseRefJson: JSON.stringify({dev: ['tier-2-unit', 'budget-gate']}),
            })
            expect(exitCode).toBe(1)
            expect(result.ciFailures).toEqual([{
                kind: 'missing-required-tier',
                tier: 2,
                message: 'required tier_2 for dev produced no check reports',
            }])
        })
    })

    it('allows conditional tier 4 to skip when the precheck says it is not required', async () => {
        await withFixture([], {4: {wallClockMs: 10_000, sumMs: null, perCheckMaxRatio: 0.6}}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate({
                ...opts,
                baseRef: 'main',
                needsJson: JSON.stringify({
                    'tier4-precheck': {result: 'success', outputs: {should_run: 'false'}},
                    'tier-4-analyzers': {result: 'skipped'},
                }),
                conditionalJobsByBaseRefJson: JSON.stringify({main: ['tier-4-analyzers']}),
                conditionalPrecheckByJobIdJson: JSON.stringify({'tier-4-analyzers': 'tier4-precheck'}),
            })
            expect(exitCode).toBe(0)
            expect(result.ciFailures).toEqual([])
        })
    })

    it('fails when conditional tier 4 skips after the precheck required it', async () => {
        await withFixture([], {4: {wallClockMs: 10_000, sumMs: null, perCheckMaxRatio: 0.6}}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate({
                ...opts,
                baseRef: 'main',
                needsJson: JSON.stringify({
                    'tier4-precheck': {result: 'success', outputs: {should_run: 'true'}},
                    'tier-4-analyzers': {result: 'skipped'},
                }),
                conditionalJobsByBaseRefJson: JSON.stringify({main: ['tier-4-analyzers']}),
                conditionalPrecheckByJobIdJson: JSON.stringify({'tier-4-analyzers': 'tier4-precheck'}),
            })
            expect(exitCode).toBe(1)
            expect(result.ciFailures).toEqual([{
                kind: 'conditional-job',
                jobId: 'tier-4-analyzers',
                message: 'conditional job tier-4-analyzers for main finished with skipped while precheck tier4-precheck should_run=true',
            }])
        })
    })
})

describe('runTierBudgetGate — result file', () => {
    it('writes the machine-readable result JSON to opts.resultFile', async () => {
        await withFixture([
            {checkId: 'slow', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:10.000Z'},
        ], {1: TIER_1_BUDGET}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(1)
            const written = JSON.parse(await (await import('node:fs/promises')).readFile(opts.resultFile, 'utf8'))
            expect(written).toEqual(result)
        })
    })

    it('exits 0 and writes an empty-tiers result when no reports exist', async () => {
        await withFixture([], {1: TIER_1_BUDGET}, async (opts) => {
            const {result, exitCode} = await runTierBudgetGate(opts)
            expect(exitCode).toBe(0)
            expect(result.tiersEvaluated).toEqual([])
            expect(result.breaches).toEqual([])
        })
    })
})
