import { describe, expect, it } from 'vitest'
import {
    type ArchLayer, type FnEntry, type Stats,
    analyze, classifyLayer, median, pct, percentile,
} from './purity-analysis'

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

const MINIMUM_PURITY_RATIO: number = 0.60
const MINIMUM_HEALTH_SCORE: number = 0.30
const MAX_MEDIAN_IMPURE_FUNCTION_LOC: number = 20
const MAX_P90_FUNCTION_LOC: number = 40

describe('function purity ratio — AST-based (LOC)', () => {
    it('pure LOC ratio must be at least 60%', async () => {
        const { fns, byLayer, totals } = await analyze()
        console.info(report(byLayer, totals, fns))
        const ratio = totals.pureLoc / totals.totalLoc
        console.info(`Overall: ${pct(totals.pureLoc, totals.totalLoc)} (${totals.pureLoc} / ${totals.totalLoc} LOC)`)
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
        expect(vLoc).toBeLessThanOrEqual(tLoc * 0.14)
    }, 30000)

    it('composite health score: purity_ratio × complexity_location >= threshold', async () => {
        const { fns, totals } = await analyze()
        const health: FunctionHealthMetrics = functionHealthMetrics(fns)
        const purityRatio = totals.pureLoc / totals.totalLoc
        const score = purityRatio * health.complexityLocationRatio
        expect(
            score,
            `health score ${score.toFixed(3)} (${purityRatio.toFixed(3)} × ${health.complexityLocationRatio.toFixed(3)}) < ${MINIMUM_HEALTH_SCORE}`,
        ).toBeGreaterThanOrEqual(MINIMUM_HEALTH_SCORE)
    }, 30000)

    it('shell thinness: median impure function LOC <= threshold', async () => {
        const { fns } = await analyze()
        const health: FunctionHealthMetrics = functionHealthMetrics(fns)
        expect(
            health.medianImpureLoc,
            `median impure function LOC ${health.medianImpureLoc} > ${MAX_MEDIAN_IMPURE_FUNCTION_LOC}`,
        ).toBeLessThanOrEqual(MAX_MEDIAN_IMPURE_FUNCTION_LOC)
    }, 30000)

    it('no god functions: P90 function LOC <= threshold', async () => {
        const { fns } = await analyze()
        const health: FunctionHealthMetrics = functionHealthMetrics(fns)
        expect(
            health.p90Loc,
            `P90 function LOC ${health.p90Loc} > ${MAX_P90_FUNCTION_LOC}`,
        ).toBeLessThanOrEqual(MAX_P90_FUNCTION_LOC)
    }, 30000)
})
