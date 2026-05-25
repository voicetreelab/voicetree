// Tier wall-clock budget gate — single public entry point.
//
// `runTierBudgetGate(opts)` reads CheckReports from `opts.reportsDir`, loads
// each tier's `_budget.ts` from `opts.tierRoot`, computes per-tier wall-clock
// (max(endedAt) − min(startedAt)) and sum-of-durations, compares against
// budgets, and writes a machine-readable result to `opts.resultFile`. Returns
// the result + an exitCode (1 on budget breach, 0 otherwise).
//
// The CheckDef at checks/tier_4/analyzers/timing-budget-gate.ts spawns this file
// as a subprocess via the CLI shell at the bottom.

import {mkdir, readdir, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const SCRIPT_DIR: string = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT: string = resolve(SCRIPT_DIR, '..', '..', '..')
const DEFAULT_CHECKS_DIR: string = join(REPO_ROOT, 'health-dashboard', 'reports', 'checks')
const DEFAULT_TIER_ROOT: string = join(REPO_ROOT, 'packages', 'measures', 'src', 'checks')
// Lives under reports/gates/ so the health-report writer (which scans
// reports/*.json by kebab-case name) doesn't try to parse it as a metric.
const DEFAULT_RESULT_FILE: string = join(REPO_ROOT, 'health-dashboard', 'reports', 'gates', 'tier-budget.json')

const TIER_PATH_PATTERN = /\/checks\/tier_(\d+)(?:\/|_)/

// The gate excludes its own report from aggregation — otherwise it gates
// against its own sub-second duration, which is meaningless.
const GATE_CHECK_ID = 'tier-time-budget-gate'

export type EvaluationResult = {
    readonly tiersEvaluated: readonly number[]
    readonly tierTimings: readonly {
        readonly tier: number
        readonly wallClockMs: number
        readonly sumMs: number
        readonly checkCount: number
        readonly slowest: {readonly checkId: string; readonly durationMs: number} | null
    }[]
    readonly breaches: readonly {
        readonly tier: number
        readonly kind: 'wallClock' | 'sum'
        readonly observedMs: number
        readonly budgetMs: number
        readonly ratio: number
    }[]
    readonly perCheckWarnings: readonly {
        readonly tier: number
        readonly checkId: string
        readonly durationMs: number
        readonly ratio: number
    }[]
    readonly ciFailures: readonly {
        readonly kind: 'required-job' | 'conditional-job' | 'missing-required-tier'
        readonly jobId?: string
        readonly tier?: number
        readonly message: string
    }[]
}

export type RunTierBudgetGateOptions = {
    readonly reportsDir?: string
    readonly tierRoot?: string
    readonly resultFile?: string
    readonly baseRef?: string
    readonly needsJson?: string
    readonly requiredJobsByBaseRefJson?: string
    readonly conditionalJobsByBaseRefJson?: string
    readonly conditionalPrecheckByJobIdJson?: string
}

export async function runTierBudgetGate(opts: RunTierBudgetGateOptions = {}): Promise<{
    readonly result: EvaluationResult
    readonly exitCode: 0 | 1
    readonly report: string
}> {
    const reportsDir = opts.reportsDir ?? DEFAULT_CHECKS_DIR
    const tierRoot = opts.tierRoot ?? DEFAULT_TIER_ROOT
    const resultFile = opts.resultFile ?? DEFAULT_RESULT_FILE
    const reports = await loadReportsFromDir(reportsDir)
    const budgets = await loadBudgetsFromDir(tierRoot)
    const timings = aggregateTierTimings(reports)
    const budgetResult = evaluateBudgets(timings, budgets)
    const result: EvaluationResult = {
        ...budgetResult,
        ciFailures: evaluateCiIntegrity(timings, {
            baseRef: opts.baseRef ?? process.env.GITHUB_BASE_REF ?? '',
            needsJson: opts.needsJson ?? process.env.MEASURES_WORKFLOW_NEEDS_JSON ?? '',
            requiredJobsByBaseRefJson: opts.requiredJobsByBaseRefJson ?? process.env.MEASURES_REQUIRED_JOBS_BY_BASE_REF ?? '',
            conditionalJobsByBaseRefJson: opts.conditionalJobsByBaseRefJson ?? process.env.MEASURES_CONDITIONAL_JOBS_BY_BASE_REF ?? '',
            conditionalPrecheckByJobIdJson: opts.conditionalPrecheckByJobIdJson ?? process.env.MEASURES_CONDITIONAL_PRECHECK_BY_JOB_ID ?? '',
        }),
    }
    const report = formatResult(result)
    await writeJsonAtomic(resultFile, result)
    return {result, exitCode: result.breaches.length > 0 || result.ciFailures.length > 0 ? 1 : 0, report}
}

// ── internals (intentionally NOT exported) ──────────────────────────────────

type TierBudget = {
    readonly wallClockMs: number
    readonly sumMs: number | null
    readonly perCheckMaxRatio: number
}

type ReportLike = {
    readonly checkId: string
    readonly durationMs: number
    readonly startedAt: string
    readonly endedAt: string
    readonly status: 'pass' | 'fail' | 'skip' | string
    readonly details?: {readonly measurePath?: string}
}

type TierTiming = EvaluationResult['tierTimings'][number]
type WorkflowNeed = {
    readonly result?: string
    readonly outputs?: Record<string, string>
}

type CiIntegrityOptions = {
    readonly baseRef: string
    readonly needsJson: string
    readonly requiredJobsByBaseRefJson: string
    readonly conditionalJobsByBaseRefJson: string
    readonly conditionalPrecheckByJobIdJson: string
}

function tierOf(measurePath: string | undefined): number | null {
    if (!measurePath) return null
    const m = TIER_PATH_PATTERN.exec(measurePath)
    return m ? Number(m[1]) : null
}

function aggregateTierTimings(reports: readonly ReportLike[]): Map<number, TierTiming> {
    const byTier = new Map<number, ReportLike[]>()
    for (const r of reports) {
        const tier = tierOf(r.details?.measurePath)
        if (tier === null) continue
        if (r.status === 'skip') continue
        const bucket = byTier.get(tier)
        if (bucket) bucket.push(r); else byTier.set(tier, [r])
    }
    const out = new Map<number, TierTiming>()
    for (const [tier, group] of byTier) {
        let minStart = Number.POSITIVE_INFINITY
        let maxEnd = Number.NEGATIVE_INFINITY
        let sum = 0
        let slowest: TierTiming['slowest'] = null
        for (const r of group) {
            const s = Date.parse(r.startedAt)
            const e = Date.parse(r.endedAt)
            if (Number.isNaN(s) || Number.isNaN(e)) continue
            if (s < minStart) minStart = s
            if (e > maxEnd) maxEnd = e
            sum += r.durationMs
            if (slowest === null || r.durationMs > slowest.durationMs) {
                slowest = {checkId: r.checkId, durationMs: r.durationMs}
            }
        }
        const wallClockMs = (minStart === Number.POSITIVE_INFINITY || maxEnd === Number.NEGATIVE_INFINITY)
            ? 0 : maxEnd - minStart
        out.set(tier, {tier, wallClockMs, sumMs: sum, checkCount: group.length, slowest})
    }
    return out
}

function evaluateBudgets(
    timings: ReadonlyMap<number, TierTiming>,
    budgets: ReadonlyMap<number, TierBudget>,
): EvaluationResult {
    const breaches: EvaluationResult['breaches'][number][] = []
    const perCheckWarnings: EvaluationResult['perCheckWarnings'][number][] = []
    const tiersEvaluated: number[] = []
    for (const [tier, timing] of timings) {
        const budget = budgets.get(tier)
        if (!budget) continue
        tiersEvaluated.push(tier)
        if (timing.wallClockMs > budget.wallClockMs) {
            breaches.push({
                tier, kind: 'wallClock',
                observedMs: timing.wallClockMs, budgetMs: budget.wallClockMs,
                ratio: timing.wallClockMs / budget.wallClockMs,
            })
        }
        if (budget.sumMs !== null && timing.sumMs > budget.sumMs) {
            breaches.push({
                tier, kind: 'sum',
                observedMs: timing.sumMs, budgetMs: budget.sumMs,
                ratio: timing.sumMs / budget.sumMs,
            })
        }
        if (timing.slowest && timing.slowest.durationMs > budget.wallClockMs * budget.perCheckMaxRatio) {
            perCheckWarnings.push({
                tier,
                checkId: timing.slowest.checkId,
                durationMs: timing.slowest.durationMs,
                ratio: timing.slowest.durationMs / budget.wallClockMs,
            })
        }
    }
    return {
        tiersEvaluated: tiersEvaluated.sort((a, b) => a - b),
        tierTimings: [...timings.values()].sort((a, b) => a.tier - b.tier),
        breaches: breaches.sort((a, b) => a.tier - b.tier || a.kind.localeCompare(b.kind)),
        perCheckWarnings,
        ciFailures: [],
    }
}

function evaluateCiIntegrity(
    timings: ReadonlyMap<number, TierTiming>,
    opts: CiIntegrityOptions,
): EvaluationResult['ciFailures'] {
    if (!opts.baseRef) return []
    const requiredJobsByBase = parseJsonRecord(opts.requiredJobsByBaseRefJson)
    const conditionalJobsByBase = parseJsonRecord(opts.conditionalJobsByBaseRefJson)
    const conditionalPrecheckByJob = parseJsonStringRecord(opts.conditionalPrecheckByJobIdJson)
    const needs = parseNeeds(opts.needsJson)
    const requiredJobs = requiredJobsByBase[opts.baseRef] ?? []
    const conditionalJobs = conditionalJobsByBase[opts.baseRef] ?? []
    const failures: EvaluationResult['ciFailures'][number][] = []

    for (const jobId of requiredJobs.filter(id => id !== 'budget-gate')) {
        const result = needs[jobId]?.result ?? 'missing'
        if (result !== 'success') {
            failures.push({
                kind: 'required-job',
                jobId,
                message: `required job ${jobId} for ${opts.baseRef} finished with ${result}`,
            })
        }
    }

    for (const tier of requiredTierNumbers(requiredJobs)) {
        if (!timings.has(tier)) {
            failures.push({
                kind: 'missing-required-tier',
                tier,
                message: `required tier_${tier} for ${opts.baseRef} produced no check reports`,
            })
        }
    }

    for (const jobId of conditionalJobs) {
        const result = needs[jobId]?.result ?? 'missing'
        if (result === 'success') {
            const tier = tierNumberFromJobId(jobId)
            if (tier !== null && !timings.has(tier)) {
                failures.push({
                    kind: 'missing-required-tier',
                    jobId,
                    tier,
                    message: `conditional job ${jobId} succeeded but tier_${tier} produced no check reports`,
                })
            }
            continue
        }
        const precheckId = conditionalPrecheckByJob[jobId]
        const shouldRun = precheckId ? needs[precheckId]?.outputs?.should_run : undefined
        if (result === 'skipped' && shouldRun !== 'true') continue
        failures.push({
            kind: 'conditional-job',
            jobId,
            message: `conditional job ${jobId} for ${opts.baseRef} finished with ${result} while precheck ${precheckId ?? '(none)'} should_run=${shouldRun ?? '(missing)'}`,
        })
    }

    return failures.sort((a, b) =>
        a.kind.localeCompare(b.kind)
        || String(a.tier ?? '').localeCompare(String(b.tier ?? ''))
        || String(a.jobId ?? '').localeCompare(String(b.jobId ?? '')),
    )
}

function parseNeeds(json: string): Record<string, WorkflowNeed> {
    if (!json.trim()) return {}
    try {
        const parsed = JSON.parse(json) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        return parsed as Record<string, WorkflowNeed>
    } catch {
        return {}
    }
}

function parseJsonRecord(json: string): Record<string, readonly string[]> {
    if (!json.trim()) return {}
    try {
        const parsed = JSON.parse(json) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        const out: Record<string, readonly string[]> = {}
        for (const [key, value] of Object.entries(parsed)) {
            if (Array.isArray(value)) out[key] = value.filter((v): v is string => typeof v === 'string')
        }
        return out
    } catch {
        return {}
    }
}

function parseJsonStringRecord(json: string): Record<string, string> {
    if (!json.trim()) return {}
    try {
        const parsed = JSON.parse(json) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        const out: Record<string, string> = {}
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string') out[key] = value
        }
        return out
    } catch {
        return {}
    }
}

function requiredTierNumbers(jobIds: readonly string[]): readonly number[] {
    return [...new Set(jobIds.map(tierNumberFromJobId).filter((n): n is number => n !== null))].sort((a, b) => a - b)
}

function tierNumberFromJobId(jobId: string): number | null {
    const m = /^tier-(\d+)-/.exec(jobId)
    return m ? Number(m[1]) : null
}

function formatResult(result: EvaluationResult): string {
    const lines: string[] = []
    lines.push('Tier wall-clock budget gate')
    lines.push(`  tiers evaluated: ${result.tiersEvaluated.join(', ') || '(none)'}`)
    for (const timing of result.tierTimings) {
        lines.push(`  tier_${timing.tier}: wall-clock ${fmtMs(timing.wallClockMs)}  ·  sum ${fmtMs(timing.sumMs)}  ·  ${timing.checkCount} check(s)`)
    }
    if (result.breaches.length > 0) {
        lines.push('Breaches:')
        for (const b of result.breaches) {
            lines.push(`  ✗ tier_${b.tier} ${b.kind}: ${fmtMs(b.observedMs)} > budget ${fmtMs(b.budgetMs)} (${(b.ratio * 100).toFixed(0)}%)`)
        }
    } else {
        lines.push('All evaluated tiers within budget.')
    }
    if (result.perCheckWarnings.length > 0) {
        lines.push('Per-check warnings (slowest check exceeds tier perCheckMaxRatio):')
        for (const w of result.perCheckWarnings) {
            lines.push(`  · tier_${w.tier} ${w.checkId}: ${fmtMs(w.durationMs)} = ${(w.ratio * 100).toFixed(0)}% of tier wall-clock budget`)
        }
    }
    if (result.ciFailures.length > 0) {
        lines.push('CI integrity failures:')
        for (const failure of result.ciFailures) {
            lines.push(`  ✗ ${failure.message}`)
        }
    }
    return lines.join('\n')
}

function fmtMs(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    const m = Math.floor(ms / 60_000)
    const s = Math.round((ms % 60_000) / 1000)
    return `${m}m${s.toString().padStart(2, '0')}s`
}

async function loadReportsFromDir(dir: string): Promise<ReportLike[]> {
    let entries: readonly {isFile(): boolean; name: string}[]
    try {
        entries = await readdir(dir, {withFileTypes: true})
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
        throw err
    }
    const reports = await Promise.all(entries
        .filter(e => e.isFile() && e.name.endsWith('.json'))
        .map(async e => {
            try {
                const raw = await readFile(join(dir, e.name), 'utf8')
                return JSON.parse(raw) as ReportLike
            } catch {
                return null
            }
        }))
    return reports.filter((r): r is ReportLike =>
        r !== null
        && typeof r.checkId === 'string'
        && r.checkId !== GATE_CHECK_ID
        && typeof r.startedAt === 'string'
        && typeof r.endedAt === 'string'
        && typeof r.durationMs === 'number',
    )
}

async function loadBudgetsFromDir(tierRoot: string): Promise<Map<number, TierBudget>> {
    const budgets = new Map<number, TierBudget>()
    let entries: readonly {isDirectory(): boolean; name: string}[]
    try {
        entries = await readdir(tierRoot, {withFileTypes: true})
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return budgets
        throw err
    }
    for (const e of entries) {
        if (!e.isDirectory()) continue
        const m = /^tier_(\d+)$/.exec(e.name)
        if (!m) continue
        const tier = Number(m[1])
        const budgetPath = join(tierRoot, e.name, '_budget.ts')
        try {
            const mod = await import(pathToFileURL(budgetPath).href)
            if (mod.budget) budgets.set(tier, mod.budget as TierBudget)
        } catch (err) {
            const code = (err as NodeJS.ErrnoException).code
            if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'ENOENT') throw err
        }
    }
    return budgets
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), {recursive: true})
    const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    try {
        await rename(tmp, path)
    } catch (err) {
        await unlink(tmp).catch(() => {})
        throw err
    }
}

// ── CLI shell ───────────────────────────────────────────────────────────────

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const opts: {-readonly [K in keyof RunTierBudgetGateOptions]: RunTierBudgetGateOptions[K]} = {}
    for (const arg of process.argv.slice(2)) {
        if (arg.startsWith('--reports-dir=')) opts.reportsDir = resolve(arg.slice('--reports-dir='.length))
        else if (arg.startsWith('--tier-root=')) opts.tierRoot = resolve(arg.slice('--tier-root='.length))
        else if (arg.startsWith('--result-file=')) opts.resultFile = resolve(arg.slice('--result-file='.length))
        else if (arg.startsWith('--base-ref=')) opts.baseRef = arg.slice('--base-ref='.length)
        else if (arg.startsWith('--needs-json=')) opts.needsJson = arg.slice('--needs-json='.length)
        else if (arg.startsWith('--required-jobs-by-base-ref=')) opts.requiredJobsByBaseRefJson = arg.slice('--required-jobs-by-base-ref='.length)
        else if (arg.startsWith('--conditional-jobs-by-base-ref=')) opts.conditionalJobsByBaseRefJson = arg.slice('--conditional-jobs-by-base-ref='.length)
        else if (arg.startsWith('--conditional-precheck-by-job-id=')) opts.conditionalPrecheckByJobIdJson = arg.slice('--conditional-precheck-by-job-id='.length)
        else { console.error(`check-tier-budgets: unknown flag ${arg}`); process.exit(64) }
    }
    runTierBudgetGate(opts)
        .then(({exitCode, report}) => { console.log(report); process.exit(exitCode) })
        .catch(err => { console.error(err); process.exit(2) })
}
