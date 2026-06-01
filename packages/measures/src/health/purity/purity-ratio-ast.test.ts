import { describe, expect, it } from 'vitest'
import {
    type ArchLayer, type FnEntry, type Stats,
    GLOBAL_SIDE_EFFECT_CATEGORIES,
    analyze, classifyLayer, median, pct, percentile,
} from '../../_shared/purity-analysis'
import {recordHealthMetric} from '../../_shared/writers/report-writer'
import {readBudgetSync} from '../../_shared/budgets/read-budget.ts'

type FunctionHealthMetrics = {
    readonly medianPureLoc: number
    readonly medianImpureLoc: number
    readonly complexityLocationRatio: number
    readonly p75Loc: number
    readonly p90Loc: number
    readonly longestFunctions: readonly FnEntry[]
    readonly longestImpureFunctions: readonly FnEntry[]
}

function functionHealthMetrics(fns: readonly FnEntry[]): FunctionHealthMetrics {
    const pureLocs: number[] = fns.filter(f => f.sideEffects.length === 0).map(f => f.loc)
    const impureLocs: number[] = fns.filter(f => f.sideEffects.length > 0).map(f => f.loc)
    const allLocs: number[] = fns.map(f => f.loc)
    const medianPureLoc: number = median(pureLocs)
    const medianImpureLoc: number = median(impureLocs)
    return {
        medianPureLoc,
        medianImpureLoc,
        complexityLocationRatio: medianImpureLoc === 0 ? Infinity : medianPureLoc / medianImpureLoc,
        p75Loc: percentile(allLocs, 75),
        p90Loc: percentile(allLocs, 90),
        longestFunctions: [...fns].sort((a, b) => b.loc - a.loc).slice(0, 10),
        longestImpureFunctions: fns.filter(f => f.sideEffects.length > 0).sort((a, b) => b.loc - a.loc).slice(0, 10),
    }
}

function formatFunctionEntry(fn: FnEntry): string {
    const purity: string = fn.sideEffects.length === 0 ? 'pure' : `impure:${fn.sideEffects.join(',')}`
    return `  ${fn.file}:${fn.line} ${fn.name} ${fn.loc} LOC ${purity}`
}

function humanizeCategory(category: string): string {
    const labels: Readonly<Record<string, string>> = {
        console: 'Console',
        'fs-io': 'FS I/O',
        network: 'Network',
        nondeterministic: 'Nondeterministic',
        'process-io': 'Process I/O',
        'react-hook': 'React Hook',
        subprocess: 'Subprocess',
        timer: 'Timer',
    }
    return labels[category] ?? category
}

function globalsByCategory(fns: readonly FnEntry[]): Record<string, FnEntry[]> {
    const categories: ReadonlySet<string> = new Set(GLOBAL_SIDE_EFFECT_CATEGORIES)
    const grouped: Record<string, FnEntry[]> = Object.fromEntries(
        GLOBAL_SIDE_EFFECT_CATEGORIES.map(category => [category, [] as FnEntry[]]),
    )

    for (const fn of fns) {
        for (const category of fn.sideEffects) {
            if (categories.has(category)) grouped[category].push(fn)
        }
    }

    return grouped
}

function report(byLayer: Record<ArchLayer, Stats>, totals: Stats, fns: readonly FnEntry[]): string {
    const health: FunctionHealthMetrics = functionHealthMetrics(fns)
    const purityRatio = totals.totalLoc === 0 ? 0 : totals.pureLoc / totals.totalLoc
    const compositeScore = purityRatio * health.complexityLocationRatio
    const layers: ArchLayer[] = ['pure', 'libraries', 'systems', 'shell/edge', 'UI', 'other']
    const lines = [
        '', '┌─────────────┬────────┬────────┬────────┬────────────┬───────┐',
        '│ Layer       │  Total │   Pure │ Impure │ Pure ratio │   Fns │',
        '├─────────────┼────────┼────────┼────────┼────────────┼───────┤',
    ]
    for (const l of layers) {
        const s = byLayer[l]; if (s.totalLoc === 0) continue
        lines.push(`│ ${l.padEnd(11)} │ ${String(s.totalLoc).padStart(6)} │ ${String(s.pureLoc).padStart(6)} │ ${String(s.impureLoc).padStart(6)} │ ${pct(s.pureLoc, s.totalLoc).padStart(10)} │ ${String(s.fnCount).padStart(5)} │`)
    }
    lines.push('├─────────────┼────────┼────────┼────────┼────────────┼───────┤')
    lines.push(`│ ${'TOTAL'.padEnd(11)} │ ${String(totals.totalLoc).padStart(6)} │ ${String(totals.pureLoc).padStart(6)} │ ${String(totals.impureLoc).padStart(6)} │ ${pct(totals.pureLoc, totals.totalLoc).padStart(10)} │ ${String(totals.fnCount).padStart(5)} │`)
    lines.push('└─────────────┴────────┴────────┴────────┴────────────┴───────┘')
    lines.push('(LOC = non-empty lines inside function bodies, AST-based detection)')
    lines.push('')
    lines.push('Side-effect categories:')
    for (const [cat, loc] of Object.entries(totals.breakdown).sort(([, a], [, b]) => b - a)) {
        lines.push(`  ${cat.padEnd(20)} ${loc} LOC`)
    }
    lines.push('')
    lines.push('Function health metrics:')
    lines.push(`  Median pure LOC:         ${health.medianPureLoc}`)
    lines.push(`  Median impure LOC:       ${health.medianImpureLoc}`)
    lines.push(`  Complexity location:     ${health.complexityLocationRatio.toFixed(2)}x`)
    lines.push(`  P75 function LOC:        ${health.p75Loc}`)
    lines.push(`  P90 function LOC:        ${health.p90Loc}`)
    lines.push(`  Composite health score:  ${compositeScore.toFixed(3)} (purity ${purityRatio.toFixed(3)} × clr ${health.complexityLocationRatio.toFixed(3)})`)
    lines.push('')
    lines.push('Top 10 longest functions:')
    lines.push(...health.longestFunctions.map(formatFunctionEntry))
    lines.push('')
    lines.push('Top 10 longest impure functions:')
    lines.push(...health.longestImpureFunctions.map(formatFunctionEntry))
    return lines.join('\n')
}

// ── tests ──────────────────────────────────────────────────────────

const {
    minimumPurityRatio: MINIMUM_PURITY_RATIO,
    minimumHealthScore: MINIMUM_HEALTH_SCORE,
    maxMedianImpureFunctionLoc: MAX_MEDIAN_IMPURE_FUNCTION_LOC,
    maxP90FunctionLoc: MAX_P90_FUNCTION_LOC,
} = readBudgetSync<{minimumPurityRatio: number; minimumHealthScore: number; maxMedianImpureFunctionLoc: number; maxP90FunctionLoc: number}>('purity/purity-ratio-ast.json')

describe('function purity ratio — AST-based (LOC)', () => {
    it('pure LOC ratio must be at least 60%', async () => {
        const { fns, byLayer, totals } = await analyze()
        console.info(report(byLayer, totals, fns))
        const ratio = totals.pureLoc / totals.totalLoc
        console.info(`Overall: ${pct(totals.pureLoc, totals.totalLoc)} (${totals.pureLoc} / ${totals.totalLoc} LOC)`)
        await recordHealthMetric({
            metricId: 'purity-ratio-ast',
            metricName: 'AST Purity Ratio',
            description: 'Share of function LOC classified as pure by AST-based side-effect detection.',
            category: 'Purity',
            current: ratio,
            budget: MINIMUM_PURITY_RATIO,
            comparison: 'gte',
            unit: 'ratio',
            details: {totals, byLayer},
        })

        const globals = globalsByCategory(fns)
        await Promise.all(GLOBAL_SIDE_EFFECT_CATEGORIES.map(async category => {
            const functions = globals[category]
            await recordHealthMetric({
                metricId: `globals-${category}`,
                metricName: `Globals ${humanizeCategory(category)}`,
                description: `Functions directly tagged with ${category} global side effects.`,
                category: 'Behavioral',
                current: functions.length,
                budget: functions.length,
                comparison: 'lte',
                unit: 'functions',
                details: {
                    category,
                    functions: functions.map(fn => ({
                        file: fn.file,
                        line: fn.line,
                        name: fn.name,
                        loc: fn.loc,
                        sideEffects: fn.sideEffects,
                    })),
                },
            })
        }))

        expect(ratio, `${pct(totals.pureLoc, totals.totalLoc)} < ${pct(MINIMUM_PURITY_RATIO, 1)}`).toBeGreaterThanOrEqual(MINIMUM_PURITY_RATIO)
    }, 30000)

    it('functions in pure/ directories have no detected side effects', async () => {
        const { fns } = await analyze()
        const pureFns = fns.filter(f => f.file.includes('/pure/'))
        const violations = pureFns.filter(f => f.sideEffects.length > 0)
        const vLoc = violations.reduce((s, f) => s + f.loc, 0)
        const tLoc = pureFns.reduce((s, f) => s + f.loc, 0)
        if (violations.length > 0) {
            console.warn('pure/ violations:\n' + violations.map(f => `  ${f.file}:${f.line} ${f.name}() [${f.loc}] — ${f.sideEffects.join(', ')}`).join('\n'))
        }
        console.info(`pure/: ${tLoc} LOC, ${vLoc} LOC impure (${pct(vLoc, tLoc)})`)
        await recordHealthMetric({
            metricId: 'purity-ast-pure-dir-side-effects',
            metricName: 'AST Pure Directory Side Effects',
            description: 'Impure LOC detected inside pure/ directories by AST-based side-effect detection.',
            category: 'Purity',
            current: vLoc,
            budget: 0,
            comparison: 'lte',
            unit: 'LOC',
            details: {
                totalPureDirLoc: tLoc,
                violations,
            },
        })
        expect(vLoc).toBe(0)
    }, 30000)

    it('composite health score: purity_ratio × complexity_location >= threshold', async () => {
        const { fns, totals } = await analyze()
        const health: FunctionHealthMetrics = functionHealthMetrics(fns)
        const purityRatio = totals.pureLoc / totals.totalLoc
        const score = purityRatio * health.complexityLocationRatio
        const finiteScore = Number.isFinite(score) ? score : Number.MAX_SAFE_INTEGER
        await recordHealthMetric({
            metricId: 'purity-ast-health-score',
            metricName: 'AST Composite Health Score',
            description: 'Purity ratio multiplied by complexity-location ratio.',
            category: 'Purity',
            current: finiteScore,
            budget: MINIMUM_HEALTH_SCORE,
            comparison: 'gte',
            unit: 'score',
            details: {
                purityRatio,
                health,
            },
        })
        expect(
            score,
            `health score ${score.toFixed(3)} (${purityRatio.toFixed(3)} × ${health.complexityLocationRatio.toFixed(3)}) < ${MINIMUM_HEALTH_SCORE}`,
        ).toBeGreaterThanOrEqual(MINIMUM_HEALTH_SCORE)
    }, 30000)

    it('shell thinness: median impure function LOC <= threshold', async () => {
        const { fns } = await analyze()
        const health: FunctionHealthMetrics = functionHealthMetrics(fns)
        await recordHealthMetric({
            metricId: 'purity-ast-shell-thinness',
            metricName: 'AST Shell Thinness',
            description: 'Median LOC of impure functions.',
            category: 'Purity',
            current: health.medianImpureLoc,
            budget: MAX_MEDIAN_IMPURE_FUNCTION_LOC,
            comparison: 'lte',
            unit: 'LOC',
            details: {health},
        })
        expect(
            health.medianImpureLoc,
            `median impure function LOC ${health.medianImpureLoc} > ${MAX_MEDIAN_IMPURE_FUNCTION_LOC}`,
        ).toBeLessThanOrEqual(MAX_MEDIAN_IMPURE_FUNCTION_LOC)
    }, 30000)

    it('no god functions: P90 function LOC <= threshold', async () => {
        const { fns } = await analyze()
        const health: FunctionHealthMetrics = functionHealthMetrics(fns)
        await recordHealthMetric({
            metricId: 'purity-ast-p90-function-loc',
            metricName: 'AST P90 Function LOC',
            description: 'P90 function body line count.',
            category: 'Complexity',
            current: health.p90Loc,
            budget: MAX_P90_FUNCTION_LOC,
            comparison: 'lte',
            unit: 'LOC',
            details: {
                health,
                longestFunctions: health.longestFunctions,
            },
        })
        expect(
            health.p90Loc,
            `P90 function LOC ${health.p90Loc} > ${MAX_P90_FUNCTION_LOC}`,
        ).toBeLessThanOrEqual(MAX_P90_FUNCTION_LOC)
    }, 30000)
})
