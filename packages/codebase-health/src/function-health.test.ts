import { describe, it } from 'vitest'
import {
    type ArchLayer, type FnEntry,
    analyze, classifyLayer, median, percentile,
} from './purity-analysis'
import {recordHealthMetric} from './_health-report-test-helpers'

type FunctionHealthStats = {
    allLocs: number[]
    pureLocs: number[]
    impureLocs: number[]
    fnCount: number
    pureCount: number
    impureCount: number
    over50Count: number
}

function emptyHealthStats(): FunctionHealthStats {
    return {
        allLocs: [],
        pureLocs: [],
        impureLocs: [],
        fnCount: 0,
        pureCount: 0,
        impureCount: 0,
        over50Count: 0,
    }
}

function fmt(n: number): string {
    return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function fmtRatio(pureMedian: number, impureMedian: number): string {
    if (pureMedian === 0 || impureMedian === 0) return 'N/A'
    return (pureMedian / impureMedian).toFixed(2)
}

function bar(count: number, max: number): string {
    if (count === 0 || max === 0) return ''
    return '#'.repeat(Math.max(1, Math.round((count / max) * 24)))
}

function truncate(s: string, width: number): string {
    if (s.length <= width) return s
    if (width <= 3) return s.slice(0, width)
    return '...' + s.slice(s.length - width + 3)
}

function formatFnRow(fn: FnEntry): string {
    const location = `${fn.file}:${fn.line}`
    const purity = fn.sideEffects.length === 0 ? 'pure' : 'impure'
    const effects = fn.sideEffects.length === 0 ? '-' : fn.sideEffects.join(',')
    return `${truncate(location, 64).padEnd(64)} | ${truncate(fn.name, 34).padEnd(34)} | ${String(fn.loc).padStart(4)} | ${purity.padEnd(6)} | ${effects}`
}

function reportFunctionHistogram(fns: readonly FnEntry[]): string {
    const buckets = [
        { label: '1-5', min: 1, max: 5 },
        { label: '6-10', min: 6, max: 10 },
        { label: '11-20', min: 11, max: 20 },
        { label: '21-40', min: 21, max: 40 },
        { label: '41-80', min: 41, max: 80 },
        { label: '81-160', min: 81, max: 160 },
        { label: '160+', min: 161, max: Number.POSITIVE_INFINITY },
    ]
    const rows = buckets.map(bucket => {
        const inBucket = fns.filter(fn => fn.loc >= bucket.min && fn.loc <= bucket.max)
        const pure = inBucket.filter(fn => fn.sideEffects.length === 0).length
        const impure = inBucket.length - pure
        return { label: bucket.label, pure, impure }
    })
    const maxCount = Math.max(0, ...rows.flatMap(row => [row.pure, row.impure]))
    const lines = [
        '1. Function LOC distribution histogram',
        'Bucket  | Pure                         | Impure',
        '--------+------------------------------+------------------------------',
    ]
    for (const row of rows) {
        lines.push(`${row.label.padEnd(7)} | ${String(row.pure).padStart(4)} ${bar(row.pure, maxCount).padEnd(24)} | ${String(row.impure).padStart(4)} ${bar(row.impure, maxCount)}`)
    }
    return lines.join('\n')
}

function reportFunctionTable(title: string, fns: readonly FnEntry[]): string {
    const lines = [
        title,
        `${'file:line'.padEnd(64)} | ${'name'.padEnd(34)} |  LOC | purity | side-effect categories`,
        `${'-'.repeat(64)}-+-${'-'.repeat(34)}-+------+--------+-----------------------`,
    ]
    for (const fn of fns) lines.push(formatFnRow(fn))
    if (fns.length === 0) lines.push('(none)')
    return lines.join('\n')
}

function reportLayerHealth(byLayer: Record<ArchLayer, FunctionHealthStats>): string {
    const layers: ArchLayer[] = ['pure', 'libraries', 'systems', 'shell/edge', 'UI', 'other']
    const lines = [
        '4. Per-layer health summary',
        'Layer       | Functions pure/impure | Median pure | Median impure | Ratio | P75 | P90 | >50 LOC',
        '------------+------------------------+-------------+---------------+-------+-----+-----+--------',
    ]
    for (const layer of layers) {
        const s = byLayer[layer]
        if (s.fnCount === 0) continue
        const pureMedian = median(s.pureLocs)
        const impureMedian = median(s.impureLocs)
        lines.push(`${layer.padEnd(11)} | ${String(s.pureCount).padStart(5)} / ${String(s.impureCount).padEnd(12)} | ${fmt(pureMedian).padStart(11)} | ${fmt(impureMedian).padStart(13)} | ${fmtRatio(pureMedian, impureMedian).padStart(5)} | ${fmt(percentile(s.allLocs, 75)).padStart(3)} | ${fmt(percentile(s.allLocs, 90)).padStart(3)} | ${String(s.over50Count).padStart(7)}`)
    }
    return lines.join('\n')
}

function reportHotspotFiles(fns: readonly FnEntry[]): string {
    const byFile: Map<string, FnEntry[]> = new Map()
    for (const fn of fns) {
        const existing = byFile.get(fn.file)
        if (existing) existing.push(fn); else byFile.set(fn.file, [fn])
    }

    const hotspots = [...byFile.entries()].flatMap(([file, fileFns]) => {
        const pureMedian = median(fileFns.filter(fn => fn.sideEffects.length === 0).map(fn => fn.loc))
        const impureMedian = median(fileFns.filter(fn => fn.sideEffects.length > 0).map(fn => fn.loc))
        if (impureMedian === 0) return []
        if (pureMedian !== 0 && impureMedian <= pureMedian * 2) return []
        const ratio = pureMedian === 0 ? Number.POSITIVE_INFINITY : impureMedian / pureMedian
        return [{
            file,
            pureMedian,
            impureMedian,
            ratio,
            impureCount: fileFns.filter(fn => fn.sideEffects.length > 0).length,
            fnCount: fileFns.length,
        }]
    }).sort((a, b) => b.ratio - a.ratio || b.impureMedian - a.impureMedian).slice(0, 10)

    const lines = [
        '5. Complexity hotspot files',
        'File                                                             | Median pure | Median impure | Ratio | Impure / total',
        '-----------------------------------------------------------------+-------------+---------------+-------+---------------',
    ]
    for (const h of hotspots) {
        const ratio = h.ratio === Number.POSITIVE_INFINITY ? 'INF' : h.ratio.toFixed(2)
        lines.push(`${truncate(h.file, 64).padEnd(64)} | ${fmt(h.pureMedian).padStart(11)} | ${fmt(h.impureMedian).padStart(13)} | ${ratio.padStart(5)} | ${String(h.impureCount).padStart(6)} / ${String(h.fnCount).padEnd(5)}`)
    }
    return lines.join('\n')
}

function reportFunctionHealth(fns: readonly FnEntry[], byLayer: Record<ArchLayer, FunctionHealthStats>): string {
    const longest = [...fns].sort((a, b) => b.loc - a.loc).slice(0, 20)
    const longestImpure = fns.filter(fn => fn.sideEffects.length > 0).sort((a, b) => b.loc - a.loc).slice(0, 20)
    return [
        '',
        'Function-level health diagnostics',
        '(LOC = non-empty lines inside function bodies, AST-based side-effect detection)',
        '',
        reportFunctionHistogram(fns),
        '',
        reportFunctionTable('2. Top 20 longest functions overall', longest),
        '',
        reportFunctionTable('3. Top 20 longest impure functions', longestImpure),
        '',
        reportLayerHealth(byLayer),
        '',
        reportHotspotFiles(fns),
        '',
    ].join('\n')
}

// ── tests ──────────────────────────────────────────────────────────

describe('function-level health diagnostics', () => {
    it('prints function size and impurity health diagnostics', async () => {
        const { fns } = await analyze()
        const layers: ArchLayer[] = ['pure', 'libraries', 'systems', 'shell/edge', 'UI', 'other']
        const byLayer: Record<string, FunctionHealthStats> = {}
        for (const l of layers) byLayer[l] = emptyHealthStats()
        for (const fn of fns) {
            const s = byLayer[classifyLayer(fn.file)]
            s.fnCount++
            s.allLocs.push(fn.loc)
            if (fn.loc > 50) s.over50Count++
            if (fn.sideEffects.length === 0) {
                s.pureCount++
                s.pureLocs.push(fn.loc)
            } else {
                s.impureCount++
                s.impureLocs.push(fn.loc)
            }
        }
        console.info(reportFunctionHealth(fns, byLayer as Record<ArchLayer, FunctionHealthStats>))

        const totalPureCount = Object.values(byLayer).reduce((sum, stats) => sum + stats.pureCount, 0)
        const totalFnCount = Object.values(byLayer).reduce((sum, stats) => sum + stats.fnCount, 0)
        const pureFunctionRatio = totalFnCount === 0 ? 0 : totalPureCount / totalFnCount

        await recordHealthMetric({
            metricId: 'function-health',
            metricName: 'Function Health',
            description: 'Pure-function share from size and impurity diagnostics.',
            category: 'Complexity',
            current: pureFunctionRatio,
            budget: 0.5,
            comparison: 'gte',
            unit: 'ratio',
            details: {
                byLayer,
                totalFnCount,
                topLongestFunctions: fns.slice().sort((a, b) => b.loc - a.loc).slice(0, 20),
                hotspotReport: reportHotspotFiles(fns),
            },
        })
    }, 30000)
})
