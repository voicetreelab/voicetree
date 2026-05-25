import {
    existsSync,
    readFileSync,
    statSync,
} from 'node:fs'

import type { SpanRecord, SpanSummary } from './types'

export function ndjsonFileSize(path: string): number {
    try { return statSync(path).size } catch { return 0 }
}

export function readNdjsonTail(path: string, fromByteOffset: number): SpanRecord[] {
    if (!existsSync(path)) return []
    const buf = readFileSync(path)
    if (buf.length <= fromByteOffset) return []
    const tail = buf.subarray(fromByteOffset).toString('utf8')
    const out: SpanRecord[] = []
    for (const line of tail.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        try {
            const parsed = JSON.parse(trimmed) as SpanRecord
            out.push(parsed)
        } catch {
            // skip malformed lines (file may have been written mid-line at snapshot time)
        }
    }
    return out
}

function quantile(sorted: readonly number[], q: number): number {
    if (sorted.length === 0) return 0
    if (sorted.length === 1) return sorted[0]
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    if (lo === hi) return sorted[lo]
    const frac = pos - lo
    return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

export function summarizeSpans(spans: readonly SpanRecord[]): SpanSummary {
    const byName: Record<string, number> = {}
    const byOutcome: Record<string, number> = {}
    const durationsByName: Record<string, number[]> = {}
    for (const span of spans) {
        byName[span.name] = (byName[span.name] ?? 0) + 1
        const outcome = (span.attributes?.outcome as string | undefined) ?? null
        if (outcome) {
            const key = `${span.name}/${outcome}`
            byOutcome[key] = (byOutcome[key] ?? 0) + 1
        }
        const list = durationsByName[span.name] ?? (durationsByName[span.name] = [])
        list.push(span.durationMs)
    }
    const durationsMs: SpanSummary['durationsMs'] = {}
    for (const [name, raw] of Object.entries(durationsByName)) {
        const sorted = [...raw].sort((a, b) => a - b)
        durationsMs[name] = {
            p50: quantile(sorted, 0.5),
            p95: quantile(sorted, 0.95),
            p99: quantile(sorted, 0.99),
            max: sorted[sorted.length - 1],
        }
    }
    return { totalNew: spans.length, byName, byOutcome, durationsMs }
}
