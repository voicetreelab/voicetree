/**
 * Pure pretty-printing for CellResult values.
 *
 * `renderCellResult` and `renderCellResults` are pure: CellResult in, string
 * out. No console.log, no TTY detection, no filesystem reads. The CLI shell
 * decides whether colors are wanted (`process.stdout.isTTY`) and where the
 * rendered string is written.
 */
import type {
    CellResult,
    CheckpointResult,
    CommandAttempt,
    Coverage,
    FitnessBreakdown,
    RunTelemetry,
    SuccessResult,
} from './types.ts'

export type RenderOptions = {
    readonly color?: boolean
}

export function renderCellResult(
    result: CellResult,
    opts: RenderOptions = {}
): string {
    const color = opts.color ?? false
    const lines: string[] = []

    lines.push(renderHeader(result, color))
    lines.push(renderBadge(result.success, color))
    if (result.success.checkpoints && result.success.checkpoints.length > 0) {
        lines.push('Checkpoints:')
        for (const cp of result.success.checkpoints) {
            lines.push('  ' + renderCheckpoint(cp, color))
        }
    }
    lines.push(renderCoverage(result.coverage, result.attempts.length))
    lines.push('Attempts:')
    for (const attempt of result.attempts) {
        lines.push('  ' + renderAttempt(attempt))
    }
    lines.push(renderTelemetry(result.telemetry, color))
    lines.push(...renderFitness(result.breakdown, color))
    lines.push('Artifacts:')
    lines.push('  ' + dim(`transcript: ${result.transcriptPath}`, color))
    lines.push('  ' + dim(`shim log:   ${result.shimLogPath}`, color))

    return lines.join('\n')
}

export function renderCellResults(
    results: readonly CellResult[],
    opts: RenderOptions = {}
): string {
    const color = opts.color ?? false
    const passed = results.filter((r) => r.success.passed && r.coverage.passed).length
    const failed = results.length - passed

    const blocks: string[] = []
    blocks.push(renderSummary(results.length, passed, failed, color))

    const aggregations = aggregateByGroup(results)
    if (aggregations.length > 0) {
        blocks.push(renderAggregations(aggregations, color))
    }

    for (const r of results) {
        blocks.push(renderCellResult(r, opts))
    }

    return blocks.join('\n---\n')
}

// --- internal helpers ---------------------------------------------------

function renderHeader(result: CellResult, color: boolean): string {
    const parts = [result.scenarioId, result.model, `rep ${result.rep}`]
    return dim(parts.join(' · '), color)
}

function renderBadge(success: SuccessResult, color: boolean): string {
    const badge = success.passed ? green('✓ PASSED', color) : red('✗ FAILED', color)
    return success.detail.length > 0 ? `${badge} — ${success.detail}` : badge
}

function renderCheckpoint(cp: CheckpointResult, color: boolean): string {
    const mark = cp.passed ? green('✓', color) : red('✗', color)
    return `${mark} ${cp.name} — ${cp.detail}`
}

function renderCoverage(coverage: Coverage, expectedCount: number): string {
    const hit = expectedCount - coverage.missingVerbs.length
    const missing =
        coverage.missingVerbs.length === 0
            ? 'none'
            : coverage.missingVerbs.join(', ')
    return `Coverage: ${hit}/${expectedCount} verbs (missing: ${missing})`
}

function renderAttempt(attempt: CommandAttempt): string {
    return `${attempt.expected.verb}: ${attempt.outcome}`
}

function renderTelemetry(t: RunTelemetry, color: boolean): string {
    const seconds = (t.wallClockMs / 1000).toFixed(1)
    const text = `tokens=${t.inputTokens}/${t.outputTokens} · tool calls=${t.toolCallCount} · vt invocations=${t.vtInvocationCount} · wallclock=${seconds}s`
    return `Telemetry: ${dim(text, color)}`
}

function renderFitness(b: FitnessBreakdown, color: boolean): string[] {
    const dims = [
        `correctness=${fmt(b.correctness)}`,
        `vt_eff=${fmt(b.vtEff)}`,
        `token_eff=${fmt(b.tokenEff)}`,
        `tool_eff=${fmt(b.toolEff)}`,
        `time_eff=${fmt(b.timeEff)}`,
        `completion=${fmt(b.completion)}`,
    ].join(' · ')
    const summary = `geomean=${fmt(b.geomean)} · success=${b.successGate} · coverage=${b.coverageGate} → fitness=${fmt(b.fitness)}`
    const summaryColored = b.fitness > 0 ? green(summary, color) : red(summary, color)
    return ['Fitness:', `  ${dims}`, `  ${summaryColored}`]
}

function renderSummary(total: number, passed: number, failed: number, color: boolean): string {
    const passedTxt = passed > 0 ? green(`${passed} passed`, color) : `${passed} passed`
    const failedTxt = failed > 0 ? red(`${failed} failed`, color) : `${failed} failed`
    return `${total} cells: ${passedTxt}, ${failedTxt}`
}

type Aggregation = {
    readonly key: string
    readonly n: number
    readonly mean: number
    readonly stddev: number
}

function aggregateByGroup(results: readonly CellResult[]): readonly Aggregation[] {
    const groups = new Map<string, number[]>()
    for (const r of results) {
        const key = `${r.scenarioId} · ${r.model}`
        const arr = groups.get(key) ?? []
        arr.push(r.breakdown.fitness)
        groups.set(key, arr)
    }
    const aggs: Aggregation[] = []
    for (const [key, fitnesses] of groups) {
        if (fitnesses.length < 2) continue
        const mean = fitnesses.reduce((s, x) => s + x, 0) / fitnesses.length
        const variance =
            fitnesses.reduce((s, x) => s + (x - mean) ** 2, 0) / fitnesses.length
        aggs.push({key, n: fitnesses.length, mean, stddev: Math.sqrt(variance)})
    }
    return aggs
}

function renderAggregations(aggs: readonly Aggregation[], color: boolean): string {
    const lines = ['Aggregated fitness (multi-rep groups):']
    for (const a of aggs) {
        lines.push(
            '  ' +
                dim(
                    `${a.key}: mean=${fmt(a.mean)} stddev=${fmt(a.stddev)} (n=${a.n})`,
                    color
                )
        )
    }
    return lines.join('\n')
}

function fmt(n: number): string {
    return n.toFixed(2)
}

// --- ANSI color (inline; no dependency) ---------------------------------

function ansi(s: string, code: string, color: boolean): string {
    return color ? `\x1b[${code}m${s}\x1b[0m` : s
}

function green(s: string, color: boolean): string {
    return ansi(s, '32', color)
}

function red(s: string, color: boolean): string {
    return ansi(s, '31', color)
}

function dim(s: string, color: boolean): string {
    return ansi(s, '2', color)
}
